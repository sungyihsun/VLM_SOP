# Safe parallel SOP workflows

Use these patterns only for independent, read-heavy analysis. Do not use them
for DDM or Cosmos-Reason fine-tuning, checkpoint writes, shared configuration
writes, deployment mutation, or `run_state.yaml` updates.

Replace every angle-bracket placeholder before dispatching work.

## Multi-category RCA

Assign one worker to each failing action category in `<run_dir>`:
`<category_1>`, `<category_2>`, and `<category_3>`. Require each worker to apply
the `/sop-rca` diagnostic method only to its category, inspect evaluation logs,
confusion patterns, and relevant augmentation, DDM, VLM, and configuration
evidence, then classify the failure as data, DDM-boundary, VLM-reasoning, or
configuration. Keep the work read-only. Merge the results into one RCA ranked
by expected accuracy impact, with one recommended configuration fix per
category.

## DeepStream accuracy, latency, and logs

Use three independent workers for `@ds_sop_microservice`:

- Run action-level accuracy checks against `<TEST_VIDEO_PATH>`.
- Run the file-input latency benchmark with filled values for
  `MODEL_ROOT_DIR`, `DDM_MODEL_PATH`, `VLLM_MODEL_PATH`, `VLM_FPS`, and
  `VLM_MAX_PIXELS`.
- Review the same run's pipeline logs for dropped frames, GPU-memory warnings,
  and silent restarts.

Ensure the benchmark and log review consume stable artifacts rather than
racing a producer. Merge pass/fail results with artifact and file/line evidence,
and identify production-handoff blockers.

## Cross-camera or cross-site regression

Assign one worker per `<camera_or_site>` and use isolated result directories.
Each worker evaluates `<checkpoint_path>` against only its held-out test set and
reports sequence accuracy plus the three most confused action pairs. Merge the
results into a side-by-side table and compare each site with its previous
checkpoint. Flag every regression.

## VSS build/deploy/test triage

Keep this investigation read-only. Assign separate workers to review the last
run's VSS build-stage logs, deploy preflight/model-verification output, and VSS
test results. Do not rerun the pipeline. Merge the evidence to identify the
actual failed stage, root cause, and whether a full rerun or single-stage retry
is appropriate.

