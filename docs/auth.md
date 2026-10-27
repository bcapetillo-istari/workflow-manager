# Authentication Design (Phase 6)

Goal: a user already signed in to the Istari UI opens Workflow Manager on the same host and is signed in without typing anything, and every call Workflow Manager makes to the registry carries a token that identifies that user.

## How the Istari frontend authenticates today (observed on demo, 2026-10-27)

- The frontend is a standard OpenID Connect public client using the `oidc-client-ts` family (`react-oidc-context`). Its runtime config (`/env-config.js`) supplies `VITE_ZITADEL_AUTHORITY` (Zitadel issuer) and `VITE_ZITADEL_CLIENT_ID` (an application inside Zitadel's `istari` project).
- Flow: Authorization Code with PKCE, redirect URI equal to the frontend root, `automaticSilentRenew`, scopes `openid profile email offline_access urn:zitadel:iam:org:project:id:zitadel:aud urn:zitadel:iam:user:resourceowner`. `offline_access` gives a refresh token, which is how silent renew works.
- Storage: the library's user object (access token, refresh token, id token, profile, expiry) is kept in `localStorage` under `oidc.user:<authority>:<client_id>`; a copy is also written to `localStorage["istari-user"]`.
- The registry accepts the access token as a bearer token and validates it against Zitadel (issuer and audience). The MCP service is an existing second client in the same project, so the registry already accepts tokens from more than one client.
- Demo additionally fronts Zitadel with an identity router; Model One uses Zitadel directly. The design below is written for Zitadel direct, with the router noted where it differs.

## The two ways to "use the existing session"

### A. Our own OIDC client in the same Zitadel project, signed in silently by Zitadel's session (recommended)

Zitadel keeps its own single-sign-on session cookie on the Zitadel host. When Workflow Manager redirects the browser to Zitadel's authorize endpoint and the user already has an Istari session, Zitadel issues the code immediately and redirects back with no login screen. The user experiences "I was already signed in." That is the existing session being used, through the front door.

What it takes:

| Where | Change | Nature |
|---|---|---|
| Zitadel | Register one application in the existing `istari` project: type User Agent (PKCE, no client secret), redirect URI `https://<istari-host>/apps/workflows/`, post-logout URI the same, refresh tokens enabled, same scopes as the frontend | Identity provider configuration. Preferred: an entry in the Zitadel configurator values so it is created by the same job that creates the platform's clients. Fallback: manual step in the Zitadel console, documented in the runbook. |
| Workflow Manager | `PkceAuth` implementing the existing `AuthProvider` interface with `oidc-client-ts`: authority and client id from `config.json`, redirect URI derived from `BASE_URL`, PKCE, `automaticSilentRenew` via refresh token, tokens held in memory (`InMemoryWebStorage`), sign-out via Zitadel end-session | Application code, already designed for; replaces the development credential box |
| Registry service | None | The token is a Zitadel token for the same project with the same audience; the registry validates it as it validates the frontend's |
| Platform frontend | None | |

Properties: no secret anywhere (public client with PKCE), per-user tokens so Istari's audit names the human, revocation and session lifetime governed by Zitadel exactly as for the UI, sign-out from either app ends the shared Zitadel session if desired.

Being in the same Zitadel project matters: the project is what the token's audience names, and it is what the registry trusts. A client in a different project would produce tokens the registry rejects.

Change-control view: this is an identity-provider configuration addition (one application), not a change to authentication logic in any existing component. It does not raise the SIA level beyond the Level 2 the new container already carries.

### B. Read the frontend's token from shared same-origin storage (demo only, not for production)

Because Workflow Manager is served from the frontend's origin, the browser lets it read the frontend's `localStorage`, including the `oidc.user:...` record with a live access token. A development build could use that token as its bearer and be "signed in" with zero identity-provider changes.

Why not for production:

- It depends on another application's library internals (storage key format and object shape). A frontend upgrade can break it silently.
- The record also holds the frontend's refresh token. Zitadel rotates refresh tokens, so if Workflow Manager ever used it to renew, it would invalidate the frontend's session. Read-only use of the access token avoids that but then Workflow Manager cannot renew and dies after the token lifetime (15 minutes on demo).
- A reviewer will reasonably call it one application reading another's credentials, even though the browser's same-origin model permits it. Option A has a clean story; this does not.

Use, if at all, only as a stopgap to demonstrate single sign-on before the Zitadel application is registered, and remove it afterwards.

## Decision

Implement A. Two ways to provision the client exist; use the first for the initial deployment and move to the second when the platform's configurator supports it. Keep the development credential box behind the build flag for local work against environments where neither is in place.

### Provisioning path 1: add our redirect URI to the frontend's existing client (supported by the install tooling today)

The Zitadel configurator chart that every Istari install runs takes `frontend_service_redirect_uris` and `frontend_service_post_logout_redirect_uris` as lists. Adding `https://<istari-host>/apps/workflows/` to both lists and re-running the configurator registers our redirect on the frontend's client. Workflow Manager then uses the frontend's own client id (public information, published in the frontend's `/env-config.js`) and authority.

- Pros: no new Zitadel object; a two-line values change applied through the mechanism the install team already uses; nothing new for the registry; identical token lifetimes and scopes to the UI.
- Cons: both apps share one client identity, so Zitadel's logs cannot tell them apart (the registry's job and access records still name the user, which is what matters for audit); the frontend client's redirect list now includes a second path on the same host.
- Change-control view: an additive configuration value on an existing, approved client, same host. Reads as a Level 0 or 1 config change, inside the Level 2 the new container already carries.

### Provisioning path 2: a dedicated application in the same project (target state)

A separate User Agent application in the `istari` project with its own client id. The configurator does not currently create additional applications, so this needs either a configurator enhancement from the platform team (an `additional_applications` list) or a manual Zitadel console or Terraform step owned by the install team.

- Pros: separate client identity in Zitadel, independent redirect list and token settings, cleaner ownership.
- Cons: a new identity-provider object and a process to create it in the air gap.

Workflow Manager's code is identical under both paths; only `oidcClientId` in its config differs.

## Runtime flow

```
User (signed in to Istari UI)            Workflow Manager SPA                 Zitadel                      Registry
        │  opens https://istari.<host>/apps/workflows/
        │────────────────────────────────────►│
        │                                     │ no token in memory → signinRedirect (PKCE: code_challenge, state=intended route)
        │◄────────────────────────────────────│
        │  GET /oauth/v2/authorize?client_id&redirect_uri=/apps/workflows/&scope=...&code_challenge
        │─────────────────────────────────────────────────────────────────►│
        │                                                                   │ SSO session cookie present → no login UI
        │◄── 302 https://istari.<host>/apps/workflows/?code=…&state=… ────│
        │────────────────────────────────────►│
        │                                     │ POST /oauth/v2/token (code + code_verifier) ────────►│
        │                                     │◄─── access_token (≈15 min), refresh_token, id_token ─│
        │                                     │ keep in memory; restore intended route
        │                                     │ GET /registry/api/... Authorization: Bearer <access_token> ──────────────►│
        │                                     │◄──────────────────────────────────────────── 200 (as the user) ───────────│
        │                                     │ before expiry: POST /oauth/v2/token (refresh_token) → new tokens (silent)
        │                                     │ on 401: signinSilent → if it fails, signinRedirect
        │  Sign out: end-session at Zitadel, post_logout_redirect_uri → /apps/workflows/
```

No step involves the Istari frontend's code or storage. If the user is not signed in to Istari at all, step three shows Zitadel's normal login page, and afterwards both apps are signed in because the Zitadel session is shared.

## What needs to happen, in order

1. **Platform team / install team, Zitadel.** Path 1: add the Workflow Manager redirect and post-logout URIs to the configurator values and run `helm upgrade --install istari-zitadel-configurator ...` as in the install guide; confirm in the Zitadel console that the frontend application lists both URIs. Path 2: create the application and record its client id.
2. **Install team, Workflow Manager Helm values.** Set `config.oidcAuthority` (the Zitadel issuer, same value the frontend uses as `VITE_ZITADEL_AUTHORITY`) and `config.oidcClientId` (the frontend's client id under path 1, the new application's under path 2); `config.devAuth: false`. These render into the `config.json` ConfigMap.
3. **FDE, application.** Implement `PkceAuth` (notes below), select it when `config.devAuth` is false and `oidcAuthority` is set, keep `DevTokenAuth` only in development builds.
4. **Verify.** Signed-in Istari user opens `/apps/workflows/`: lands on the catalog with no prompt; header shows their name; a run's job in Istari shows them as the submitter. Signed-out user: sees Zitadel login, then the catalog. Token expiry: leave a tab open past the access token lifetime; the next action succeeds without a redirect. Sign out from Workflow Manager, reload the Istari UI: observe whether the shared session is ended (expected yes) and document it.
5. **Rollback.** Remove the redirect URIs from the configurator values and re-run it (path 1) or delete the application (path 2); set `devAuth` or uninstall the release. The platform is unchanged either way.

## SIA notes

- The new container is the Level 2 item. The authentication change is configuration on the identity provider: additive redirect URIs on an approved client (path 1) or one new public client in the approved project (path 2). Neither modifies registry, frontend, or Zitadel code or policy.
- No secrets are introduced: public client with PKCE.
- Tokens are held in memory only; the app never writes credentials to browser storage.
- Attribution: every registry call and every job carries the user's own token.

## Implementation notes for `PkceAuth`

- `oidc-client-ts` `UserManager` with: `authority`, `client_id`, `redirect_uri = window.location.origin + BASE_URL`, `post_logout_redirect_uri` the same, `response_type: 'code'`, `scope` identical to the frontend's, `automaticSilentRenew: true`, `userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() })`.
- On load: handle the code callback if `code` and `state` are in the query, else `getUser()`; if no user, `signinRedirect()`. The user lands back on the route they asked for (store the intended path in `state`).
- `getToken()` returns the in-memory access token; the gateway's 401 handler triggers `signinSilent()` then a redirect if that fails.
- `config.json` gains `oidcAuthority` and `oidcClientId`; `devAuth` false in production.
- Tests: mock `UserManager`; verify callback handling, token exposure, 401 recovery, and that nothing is written to `localStorage`.

## Open questions for the platform team

1. Model One: confirm Zitadel is the direct issuer (no identity router) and which project the frontend client lives in.
2. Whether the Zitadel configurator values accept additional applications, so the client is created by the install job.
3. Access token lifetime and refresh token policy in Model One's Zitadel, to size the silent renew behavior.
4. Whether the registry's audience check is per project or per client (expected per project; the MCP service suggests per project).
