/**
 * Pure builder for the `POST /v2/models/{resourceId}/jobs` request (schema `NewJob`).
 * Kept free of I/O so the exact body shape can be unit-tested without creating a live job.
 *
 *   { revision: FileRevision, auth_bindings: NewCredentialBinding[] }
 *
 * - The parameters blob is referenced by a client-minted FileRevision (ids/timestamps minted here).
 * - Extra `user_model` inputs go into `revision.sources` as `Source` rows
 *   `{ revision_id, relationship_identifier }` (the function input key, e.g. "file2"); the primary
 *   input stays the URL's model_id. Matches the legacy SDK's `StorageApi.create_revision(sources=...)`.
 * - Credential bindings go into top-level `auth_bindings` as `{ input_name, credential_id }`.
 */
import type { CreateJobRequest } from '../types';
import type { Query } from './http';
import type { UploadedBlob } from './storage';

export interface JobSourceBody {
  revision_id: string;
  file_id: null;
  resource_type: null;
  resource_id: null;
  relationship_identifier: string | null;
}

export interface JobAuthBindingBody {
  input_name: string;
  credential_id: string;
}

export interface NewJobBody {
  revision: {
    id: string;
    created: string;
    file_id: null;
    content_token: { id: string; created: string; sha: string; salt: string };
    properties_token: { id: string; created: string; sha: string; salt: string };
    archive_status_history: {
      id: string;
      created: string;
      name: 'Active';
      reason: string;
      created_by_id: null;
      file_revision_id: string;
    }[];
    name: string;
    extension: string;
    size: number;
    mime: string | null;
    sources: JobSourceBody[];
  };
  auth_bindings: JobAuthBindingBody[];
}

export interface JobBodyClock {
  now: () => string;
  uuid: () => string;
}

const realClock: JobBodyClock = {
  now: () => new Date().toISOString(),
  uuid: () => crypto.randomUUID(),
};

export function buildJobBody(
  req: CreateJobRequest,
  params: UploadedBlob,
  clock: JobBodyClock = realClock,
): NewJobBody {
  const now = clock.now();
  const revisionId = clock.uuid();
  return {
    revision: {
      id: revisionId,
      created: now,
      file_id: null,
      content_token: {
        id: clock.uuid(),
        created: now,
        sha: params.contentToken.sha,
        salt: params.contentToken.salt,
      },
      properties_token: {
        id: clock.uuid(),
        created: now,
        sha: params.propertiesToken.sha,
        salt: params.propertiesToken.salt,
      },
      archive_status_history: [
        {
          id: clock.uuid(),
          created: now,
          name: 'Active',
          reason: 'Initial',
          created_by_id: null,
          file_revision_id: revisionId,
        },
      ],
      name: params.fileName,
      extension: params.extension,
      size: params.size,
      mime: params.mime,
      sources: (req.sources ?? []).map((s) => ({
        revision_id: s.revisionId,
        file_id: null,
        resource_type: null,
        resource_id: null,
        relationship_identifier: s.relationshipIdentifier ?? null,
      })),
    },
    auth_bindings: (req.authBindings ?? []).map((b) => ({
      input_name: b.inputName,
      credential_id: b.credentialId,
    })),
  };
}

/** Query string of the job POST; undefined values are dropped by HttpClient. */
export function buildJobQuery(req: CreateJobRequest): Query {
  return {
    function_name: req.functionName,
    function_version: req.functionVersion,
    tool_name: req.toolName,
    tool_version: req.toolVersion,
    operating_system: req.operatingSystem,
    assigned_agent_pool_id: req.agentPoolId,
  };
}
