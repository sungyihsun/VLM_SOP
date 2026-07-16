# Parallel Subagent Prompt Templates

Reusable prompts for the read-heavy tasks in this repo that are safe to
parallelize (see AGENTS.md → "Parallel subagents — when it's safe"). Copy,
fill in the `<...>` placeholders, and paste into Claude Code / Codex.

Do not use these patterns for `/sop-cr-finetuning`, `/sop-ddm-finetuning`,
or any step that writes checkpoints/configs — keep those single-threaded.

---

## 1. Multi-category RCA after a failed eval

Use when `/sop-e2e-inference` or `/sop-by-action-eval` reports failures across
more than one action category and you want root causes fast instead of
diagnosing categories one at a time.

```
Diagnose the failed eval run at <run_dir> with parallel subagents, one per
failing action category: <category_1>, <category_2>, <category_3>.
Each subagent should follow the /sop-rca skill's diagnostic method for its
category only — read the eval logs, confusion patterns, and relevant config
(augmentation / DDM / VLM) for that category, and classify the failure mode
(data, DDM-boundary, VLM-reasoning, or config).
Wait for all subagents, then merge into one RCA report ranked by expected
accuracy impact, with one recommended config fix per category. Do not modify
any files — this is diagnosis only.
```

---

## 2. Evaluate + benchmark the DeepStream microservice

Use after `deepstream-sop` code generation, before deciding whether to accept
the microservice.

```
Evaluate @ds_sop_microservice with parallel subagents:
- Subagent A: run /sop-by-action-eval-equivalent accuracy checks against
  <TEST_VIDEO_PATH>.
- Subagent B: run the latency benchmark for file input with
  MODEL_ROOT_DIR=<...>, DDM_MODEL_PATH=<...>, VLLM_MODEL_PATH=<...>,
  VLM_FPS=<...>, VLM_MAX_PIXELS=<...>.
- Subagent C: review DeepStream pipeline logs for dropped frames, GPU memory
  warnings, or silent restarts during the run.
Wait for all three, then summarize pass/fail per subagent with file/line
references, and flag anything that would block a production handoff.
```

---

## 3. Cross-camera / cross-site regression check

Use when validating a fine-tuned checkpoint across more than one physical
camera or factory line before rollout (e.g. multiple D1 line cameras).

```
Regression-test the checkpoint at <checkpoint_path> with one subagent per
camera/site: <camera_1>, <camera_2>, <camera_3>. Each subagent runs
/sop-e2e-inference against that camera's held-out test set only and reports
seq_accuracy plus the top 3 confused action pairs. Wait for all subagents,
then produce one table comparing sites side by side and flag any site that
regressed relative to its previous checkpoint.
```

---

## 4. VSS build/deploy/test triage (read-only investigation)

Use when `/vss-sop-build` fails at an unclear stage and you want to narrow
down where before re-running the full 4-stage pipeline.

```
Investigate why the last /vss-sop-build run failed, using parallel
subagents: one reviewing the vss-sop-build stage logs, one reviewing
vss-sop-deploy preflight/model-verification output, one reviewing
vss-sop-test results. Wait for all three, then report which stage actually
failed, the root cause, and whether a full re-run or a single-stage retry
is sufficient. Do not re-run the pipeline yourself — diagnosis only.
```
