/** Raw registry payload shapes (only the fields this gateway reads). Snake_case mirrors the API. */

export interface TokenDto {
  id?: string;
  sha: string;
  salt: string;
  created?: string;
}

/** v3 ResourceDto: GET /v3/resources, GET /v3/resources/{id}. */
export interface ResourceDto {
  file_id: string;
  resource_id: string;
  resource_type: string;
  content_token: TokenDto;
  properties_token: TokenDto;
  created: string;
  created_by_id: string;
  archived?: boolean;
  file_revision_id: string;
  updated?: string | null;
  updated_by_id?: string | null;
  name: string | null;
  extension?: string | null;
  size?: number | null;
  mime?: string | null;
  description?: string | null;
  version_name?: string | null;
  display_name?: string | null;
}

/** v3 ResourceRevisionDto: GET /v3/resources/{id}/revisions[/{rev}]. */
export interface ResourceRevisionDto {
  owning_entity_id?: string | null;
  file_id: string;
  file_revision_id: string;
  name: string | null;
  created: string;
  created_by_id: string;
  version_name?: string | null;
  description?: string | null;
  extension?: string | null;
  size?: number | null;
  mime?: string | null;
  content_token: TokenDto;
  properties_token: TokenDto;
}

/** v2 User: GET /v2/users/me. */
export interface UserDto {
  id: string;
  email?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  user_name?: string | null;
}

/** v2 System. */
export interface SystemDto {
  id: string;
  name: string;
  description?: string | null;
}

/** v2 SnapshotTag (a branch). */
export interface SnapshotTagDto {
  id: string;
  tag: string;
  is_baseline: boolean;
  snapshot_id: string;
  archive_status?: string;
}

export interface SystemBaselineDto {
  system_id: string;
  tag_id: string;
  snapshot_id: string;
}

export interface SnapshotDto {
  id: string;
  configuration_id: string;
  created: string;
}

export interface SystemConfigurationDto {
  id: string;
  name: string;
}

export interface TrackedFileDto {
  id: string;
  specifier_type: 'Locked' | 'Latest';
  file_id: string;
  current_file_revision_id: string;
  pinned_file_revision_id?: string | null;
  path: string;
  resource_id?: string | null;
}

export interface NewTrackedFileDto {
  specifier_type: 'Locked' | 'Latest';
  file_id: string;
  pinned_file_revision_id?: string | null;
  folder_path?: string | null;
}

/** v2 StoredCredential: GET /v2/credentials. */
export interface StoredCredentialDto {
  id: string;
  name: string;
  auth_type: string;
  status: string;
  auth_integration_id?: string | null;
  account_identity?: string | null;
}

/** v2 FunctionVersion: GET /v2/modules/versions/functions. */
export interface FunctionVersionDto {
  id: string;
  name: string;
  version: string;
  module_name: string;
  module_version: string;
  tool_name?: string | null;
  tool_display_name?: string | null;
  tool_versions?: { tool_version: string }[];
  operating_systems?: { name: string }[];
}

export interface JobStatusDto {
  created: string;
  name: string;
  message?: string | null;
}

/** v2 Job. */
export interface JobDto {
  id: string;
  created: string;
  created_by_id: string;
  model_id?: string | null;
  function: { name: string; version: string };
  status_history: JobStatusDto[];
}

/** v2 FileRevision as embedded in Artifact.file.revisions. */
export interface FileRevisionDto {
  id: string;
  created: string;
  name?: string | null;
  extension?: string | null;
  size?: number | null;
  mime?: string | null;
}

/** v2 Artifact: GET /v2/models/{id}/artifacts. */
export interface ArtifactDto {
  id: string;
  created: string;
  model_id?: string | null;
  file: { id: string; revisions: FileRevisionDto[] };
}
