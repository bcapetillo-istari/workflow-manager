import { describe, expect, it } from 'vitest';
import { buildJobBody, buildJobQuery, type JobBodyClock } from './jobBody';
import type { UploadedBlob } from './storage';

const params: UploadedBlob = {
  fileName: 'parameters.json',
  extension: 'json',
  mime: 'application/json',
  size: 17,
  contentToken: { sha: 'c'.repeat(96), salt: '1'.repeat(32) },
  propertiesToken: { sha: 'p'.repeat(96), salt: '2'.repeat(32) },
};

let n = 0;
const clock: JobBodyClock = {
  now: () => '2026-10-23T00:00:00.000Z',
  uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
};

describe('buildJobBody', () => {
  it('places sources on the parameters revision and auth bindings at the top level', () => {
    n = 0;
    const body = buildJobBody(
      {
        resourceId: 'r1',
        functionName: '@istari_utils:execute_claude_opus-4.8',
        parameters: { prompt: 'hi' },
        sources: [{ revisionId: 'rev-2', relationshipIdentifier: 'file2' }, { revisionId: 'rev-3' }],
        authBindings: [{ inputName: 'auth_token', credentialId: 'cred-1' }],
      },
      params,
      clock,
    );
    expect(body).toEqual({
      revision: {
        id: '00000000-0000-4000-8000-000000000001',
        created: '2026-10-23T00:00:00.000Z',
        file_id: null,
        content_token: {
          id: '00000000-0000-4000-8000-000000000002',
          created: '2026-10-23T00:00:00.000Z',
          sha: 'c'.repeat(96),
          salt: '1'.repeat(32),
        },
        properties_token: {
          id: '00000000-0000-4000-8000-000000000003',
          created: '2026-10-23T00:00:00.000Z',
          sha: 'p'.repeat(96),
          salt: '2'.repeat(32),
        },
        archive_status_history: [
          {
            id: '00000000-0000-4000-8000-000000000004',
            created: '2026-10-23T00:00:00.000Z',
            name: 'Active',
            reason: 'Initial',
            created_by_id: null,
            file_revision_id: '00000000-0000-4000-8000-000000000001',
          },
        ],
        name: 'parameters.json',
        extension: 'json',
        size: 17,
        mime: 'application/json',
        sources: [
          {
            revision_id: 'rev-2',
            file_id: null,
            resource_type: null,
            resource_id: null,
            relationship_identifier: 'file2',
          },
          {
            revision_id: 'rev-3',
            file_id: null,
            resource_type: null,
            resource_id: null,
            relationship_identifier: null,
          },
        ],
      },
      auth_bindings: [{ input_name: 'auth_token', credential_id: 'cred-1' }],
    });
  });

  it('defaults sources and auth_bindings to empty arrays', () => {
    const body = buildJobBody({ resourceId: 'r1', functionName: 'f', parameters: {} }, params, clock);
    expect(body.revision.sources).toEqual([]);
    expect(body.auth_bindings).toEqual([]);
  });

  it('maps the query string', () => {
    expect(
      buildJobQuery({
        resourceId: 'r1',
        functionName: 'f',
        functionVersion: '1.0.5',
        toolName: 'LLM',
        toolVersion: '1',
        operatingSystem: 'Ubuntu 22.04',
        agentPoolId: 'pool',
        parameters: {},
      }),
    ).toEqual({
      function_name: 'f',
      function_version: '1.0.5',
      tool_name: 'LLM',
      tool_version: '1',
      operating_system: 'Ubuntu 22.04',
      assigned_agent_pool_id: 'pool',
    });
  });
});
