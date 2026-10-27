import { describe, expect, it } from 'vitest';
import type { JobStatus } from '../gateway/types';
import type { RunEvent } from './events';
import { createRunDocument, currentStage, nextStageKey, reduceRun, SECRET_PLACEHOLDER } from './reducer';
import type { RunDocument } from './types';
import { displayFirstManifest, fileValue, loaded, secretValue, threeStageManifest } from './testing/fixtures';

const T0 = '2026-10-23T10:00:00.000Z';
const T1 = '2026-10-23T10:01:00.000Z';
const T2 = '2026-10-23T10:02:00.000Z';
const M = threeStageManifest;

function fresh(): RunDocument {
  return createRunDocument(loaded(M), 'user-1', T0);
}
function apply(doc: RunDocument, ...events: RunEvent[]): RunDocument {
  return events.reduce((d, e) => reduceRun(d, M, e), doc);
}
const submitConfigure: RunEvent = {
  type: 'StageInputsSubmitted',
  stageKey: 'configure',
  inputs: { file1: fileValue, prompt: 'compare', api_key: 'hunter2', llm: secretValue },
  at: T1,
};
const jobCreated: RunEvent = { type: 'JobCreated', stageKey: 'configure', jobId: 'job-1', at: T1 };
function observed(status: JobStatus, message?: string): RunEvent {
  return { type: 'JobStatusObserved', stageKey: 'configure', status, message, at: T2 };
}
function running(): RunDocument {
  return apply(fresh(), submitConfigure, jobCreated);
}

describe('createRunDocument', () => {
  it('starts collecting at the first stage with all others pending', () => {
    const doc = fresh();
    expect(doc.status).toBe('in_progress');
    expect(doc.current_stage).toBe('configure');
    expect(doc.stage_order).toEqual(['configure', 'review', 'results']);
    expect(doc.stages.configure.status).toBe('collecting');
    expect(doc.stages.review.status).toBe('pending');
    expect(doc.stages.results.status).toBe('pending');
    expect(doc.manifest_resource_id).toBe('manifest-smart-diff');
    expect(doc.manifest_revision_id).toBe('manifest-smart-diff-rev1');
    expect(doc.initiator_user_id).toBe('user-1');
    expect(doc.created).toBe(T0);
    expect(doc.run_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('skips a leading display stage and lands on the first interactive stage', () => {
    const doc = createRunDocument(loaded(displayFirstManifest), 'u', T0);
    expect(doc.stages.intro.status).toBe('succeeded');
    expect(doc.current_stage).toBe('confirm');
    expect(doc.stages.confirm.status).toBe('collecting');
  });
});

describe('helpers', () => {
  it('nextStageKey and currentStage follow stage_order', () => {
    const doc = fresh();
    expect(nextStageKey(doc)).toBe('review');
    expect(currentStage(doc, M)?.key).toBe('configure');
    expect(nextStageKey({ ...doc, current_stage: 'results' })).toBeNull();
    expect(nextStageKey({ ...doc, current_stage: null })).toBeNull();
    expect(currentStage({ ...doc, current_stage: null }, M)).toBeNull();
  });
});

describe('StageInputsSubmitted', () => {
  it('on a job stage records inputs and marks the stage submitted', () => {
    const doc = apply(fresh(), submitConfigure);
    expect(doc.stages.configure.status).toBe('submitted');
    expect(doc.stages.configure.inputs?.prompt).toBe('compare');
    expect(doc.status).toBe('in_progress');
    expect(doc.updated).toBe(T1);
  });

  it('redacts secret-flagged inputs and keeps auth secret references', () => {
    const doc = apply(fresh(), submitConfigure);
    expect(doc.stages.configure.inputs?.api_key).toBe(SECRET_PLACEHOLDER);
    expect(doc.stages.configure.inputs?.llm).toEqual(secretValue);
    expect(JSON.stringify(doc)).not.toContain('hunter2');
  });

  it('on a review stage succeeds and advances through the trailing display stage to run success', () => {
    const doc = apply(running(), observed('Completed'), {
      type: 'StageInputsSubmitted',
      stageKey: 'review',
      inputs: { decision: 'accept' },
      at: T2,
    });
    expect(doc.stages.review).toMatchObject({
      status: 'succeeded',
      inputs: { decision: 'accept' },
      finished: T2,
    });
    expect(doc.stages.results).toMatchObject({ status: 'succeeded', started: T2, finished: T2 });
    expect(doc.status).toBe('succeeded');
    expect(doc.current_stage).toBeNull();
  });

  it('ignores inputs for a stage that is not current or not collecting', () => {
    const doc = fresh();
    expect(apply(doc, { ...submitConfigure, stageKey: 'review' })).toBe(doc);
    const submitted = apply(doc, submitConfigure);
    expect(apply(submitted, submitConfigure)).toBe(submitted);
    expect(apply(doc, { ...submitConfigure, stageKey: 'nope' })).toBe(doc);
  });
});

describe('JobCreated', () => {
  it('moves a submitted job stage to running and the run to running_job', () => {
    const doc = running();
    expect(doc.stages.configure).toMatchObject({ status: 'running', job_id: 'job-1', started: T1 });
    expect(doc.status).toBe('running_job');
  });

  it('is idempotent and ignored unless the stage is submitted', () => {
    const doc = running();
    expect(apply(doc, jobCreated)).toBe(doc);
    const collecting = fresh();
    expect(apply(collecting, jobCreated)).toBe(collecting);
  });
});

describe('JobStatusObserved', () => {
  it('ignores non-terminal statuses', () => {
    const doc = running();
    for (const s of [
      'Created',
      'Pending',
      'Claimed',
      'Validating',
      'Running',
      'Uploading',
      'Unknown',
    ] as const) {
      expect(apply(doc, observed(s))).toBe(doc);
    }
  });

  it('Completed succeeds the stage and advances to the review gate', () => {
    const doc = apply(running(), observed('Completed'));
    expect(doc.stages.configure).toMatchObject({ status: 'succeeded', finished: T2 });
    expect(doc.current_stage).toBe('review');
    expect(doc.stages.review.status).toBe('collecting');
    expect(doc.status).toBe('in_progress');
  });

  it('Failed fails the stage and the run with the status message', () => {
    const doc = apply(running(), observed('Failed', 'boom'));
    expect(doc.stages.configure).toMatchObject({ status: 'failed', error: 'boom', finished: T2 });
    expect(doc.status).toBe('failed');
    expect(doc.current_stage).toBeNull();
    expect(doc.result_summary).toContain('boom');
    expect(doc.stages.review.status).toBe('pending');
  });

  it('Failed without a message uses a default error', () => {
    expect(apply(running(), observed('Failed')).stages.configure.error).toBe('Job failed');
  });

  it('Canceled cancels the stage and the run', () => {
    const doc = apply(running(), observed('Canceled'));
    expect(doc.stages.configure.status).toBe('cancelled');
    expect(doc.status).toBe('cancelled');
    expect(doc.current_stage).toBeNull();
  });

  it('repeated terminal observations are idempotent', () => {
    const once = apply(running(), observed('Completed'));
    expect(apply(once, observed('Completed'))).toBe(once);
    const failed = apply(running(), observed('Failed', 'x'));
    expect(apply(failed, observed('Failed', 'x'))).toBe(failed);
    expect(apply(failed, observed('Completed'))).toBe(failed);
  });

  it('ignores observations for a stage that is not running', () => {
    const doc = fresh();
    expect(apply(doc, observed('Completed'))).toBe(doc);
  });
});

describe('ModuleUpdateObserved', () => {
  it('merges outputs and progress for a stage with a job', () => {
    const progress = [{ at: T1, message: 'half way', percent: 50 }];
    const doc = apply(running(), {
      type: 'ModuleUpdateObserved',
      stageKey: 'configure',
      outputs: { report: 'art-1' },
      progress,
    });
    expect(doc.stages.configure.outputs).toEqual({ report: 'art-1' });
    expect(doc.stages.configure.progress).toEqual(progress);
    expect(doc.updated).toBe(T1);
  });

  it('is a no-op when nothing changed or the stage has no job', () => {
    const doc = apply(running(), { type: 'ModuleUpdateObserved', stageKey: 'configure', outputs: { a: 1 } });
    expect(apply(doc, { type: 'ModuleUpdateObserved', stageKey: 'configure', outputs: { a: 1 } })).toBe(doc);
    expect(apply(doc, { type: 'ModuleUpdateObserved', stageKey: 'configure' })).toBe(doc);
    expect(apply(doc, { type: 'ModuleUpdateObserved', stageKey: 'review', outputs: { a: 1 } })).toBe(doc);
  });

  it('still applies after the stage succeeded (late module write)', () => {
    const doc = apply(running(), observed('Completed'));
    const late = apply(doc, {
      type: 'ModuleUpdateObserved',
      stageKey: 'configure',
      outputs: { report: 'r' },
    });
    expect(late.stages.configure.outputs).toEqual({ report: 'r' });
    expect(late.stages.configure.status).toBe('succeeded');
  });
});

describe('Advance', () => {
  it('is ignored unless the current stage already succeeded', () => {
    const doc = fresh();
    expect(apply(doc, { type: 'Advance', at: T1 })).toBe(doc);
    const busy = running();
    expect(apply(busy, { type: 'Advance', at: T1 })).toBe(busy);
  });

  it('advances from a succeeded current stage', () => {
    const base = fresh();
    const stuck: RunDocument = {
      ...base,
      stages: { ...base.stages, configure: { ...base.stages.configure, status: 'succeeded' } },
    };
    const doc = apply(stuck, { type: 'Advance', at: T1 });
    expect(doc.current_stage).toBe('review');
    expect(doc.stages.review.status).toBe('collecting');
    expect(doc.updated).toBe(T1);
  });
});

describe('Cancel', () => {
  it('cancels the running stage and the run', () => {
    const doc = apply(running(), { type: 'Cancel', at: T2 });
    expect(doc.stages.configure).toMatchObject({ status: 'cancelled', finished: T2 });
    expect(doc.status).toBe('cancelled');
    expect(doc.current_stage).toBeNull();
    expect(doc.stages.review.status).toBe('pending');
  });

  it('cancels while collecting at a review gate', () => {
    const doc = apply(running(), observed('Completed'), { type: 'Cancel', at: T2 });
    expect(doc.stages.review.status).toBe('cancelled');
    expect(doc.stages.configure.status).toBe('succeeded');
    expect(doc.status).toBe('cancelled');
  });
});

describe('Fail', () => {
  it('fails the current stage by default', () => {
    const doc = apply(fresh(), { type: 'Fail', error: 'bad input', at: T1 });
    expect(doc.stages.configure).toMatchObject({ status: 'failed', error: 'bad input' });
    expect(doc.status).toBe('failed');
    expect(doc.result_summary).toBe('Failed at "configure": bad input');
  });

  it('fails a named stage', () => {
    const doc = apply(fresh(), { type: 'Fail', stageKey: 'review', error: 'x', at: T1 });
    expect(doc.stages.review.status).toBe('failed');
    expect(doc.status).toBe('failed');
  });
});

describe('terminal runs', () => {
  it('ignore every event', () => {
    const done = apply(running(), observed('Failed', 'x'));
    const events: RunEvent[] = [
      submitConfigure,
      jobCreated,
      observed('Completed'),
      { type: 'ModuleUpdateObserved', stageKey: 'configure', outputs: { z: 1 } },
      { type: 'Advance', at: T2 },
      { type: 'Cancel', at: T2 },
      { type: 'Fail', error: 'again', at: T2 },
    ];
    for (const e of events) expect(apply(done, e)).toBe(done);
  });

  it('reducer never mutates its input', () => {
    const doc = running();
    const snapshot = JSON.stringify(doc);
    apply(doc, observed('Completed'), { type: 'Cancel', at: T2 });
    expect(JSON.stringify(doc)).toBe(snapshot);
  });
});

describe('run-level finished and error', () => {
  it('a succeeded run has finished and no error', () => {
    const doc = apply(running(), observed('Completed'), {
      type: 'StageInputsSubmitted',
      stageKey: 'review',
      inputs: { decision: 'accept' },
      at: T2,
    });
    expect(doc.finished).toBe(T2);
    expect(doc.error).toBeUndefined();
  });

  it('a failed job sets finished and error on the run and the stage', () => {
    const doc = apply(running(), observed('Failed', 'boom'));
    expect(doc).toMatchObject({ finished: T2, error: 'boom', result_summary: 'Failed at "configure": boom' });
    expect(doc.stages.configure.error).toBe('boom');
  });

  it('cancel and Fail events set finished and a reason', () => {
    const cancelled = apply(running(), { type: 'Cancel', at: T2 });
    expect(cancelled).toMatchObject({ finished: T2, error: 'Run cancelled' });
    expect(cancelled.result_summary).toContain('Cancelled at "configure"');
    const viaJob = apply(running(), observed('Canceled', 'operator'));
    expect(viaJob.error).toBe('operator');
    const failed = apply(fresh(), { type: 'Fail', error: 'bad input', at: T1 });
    expect(failed).toMatchObject({ finished: T1, error: 'bad input' });
  });

  it('non-terminal runs carry neither', () => {
    const doc = apply(running(), observed('Completed'));
    expect(doc.finished).toBeUndefined();
    expect(doc.error).toBeUndefined();
  });
});

describe('full happy path', () => {
  it('job -> review -> display -> succeeded', () => {
    const doc = apply(fresh(), submitConfigure, jobCreated, observed('Completed'), {
      type: 'StageInputsSubmitted',
      stageKey: 'review',
      inputs: { decision: 'accept' },
      at: T2,
    });
    expect(Object.values(doc.stages).map((s) => s.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(doc.status).toBe('succeeded');
  });
});
