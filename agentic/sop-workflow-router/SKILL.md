---
name: sop-workflow-router
description: Route and coordinate SOP monitoring work across data augmentation, DDM and Cosmos-Reason fine-tuning, action and end-to-end evaluation, RCA, DeepStream inference, and VSS build/deploy/test workflows. Use when a request spans multiple SOP skills, when the correct skill is unclear, when a failed run needs safe read-only parallel diagnosis, or when results from multiple categories, cameras, sites, accuracy checks, latency benchmarks, and logs must be merged without racing on checkpoints or run state.
---

# SOP Workflow Router

Select the existing repository skill that owns the requested work, preserve its
state-management rules, and coordinate read-heavy parallel analysis only when
the work is independent.

## Route the request

1. Read `references/routing-and-safety.md` before choosing a workflow.
2. Classify the request as data generation, fine-tuning, evaluation, RCA,
   DeepStream inference, or VSS build/deploy/test.
3. Use the owning skill named in the routing table. If the request spans stages,
   prefer the listed orchestrator instead of manually chaining sub-skills.
4. Read the selected skill's complete `SKILL.md` and follow it as the authority
   for stage-specific commands, inputs, artifacts, and completion criteria.
5. Resolve paths from the repository root. Do not assume the caller's current
   directory is the repository root.

## Protect mutable state

- Treat every `plugins/` directory as read-only during a run.
- Put run-specific changes under `<run_dir>/overrides/`.
- Keep fine-tuning, checkpoint writes, config writes, and `run_state.yaml`
  updates single-threaded.
- Run long training or watchdog-monitored evaluations in the background. Use
  the environment's non-blocking wait or monitoring mechanism instead of a
  shell polling loop.
- Count only substantive config/retrain iterations against a fine-tuning
  budget. Do not count eval-only or infrastructure iterations.

## Decide whether to parallelize

Parallelize only when all branches are read-heavy or write to isolated output
locations. Suitable axes include independent action categories, cameras,
sites, logs, latency traces, and RCA candidates.

Keep work sequential if any branch can write a shared checkpoint, shared
configuration, plugin content, deployment state, or run state. When uncertain,
keep it sequential.

If parallel work is appropriate:

1. Read `references/parallel-workflows.md`.
2. Choose the closest prompt pattern and replace every placeholder.
3. Give each worker one bounded, independent scope and explicit read-only or
   isolated-output constraints.
4. Wait for every worker to finish.
5. Merge evidence into one report, resolve contradictions, and cite artifact
   paths or file/line locations.

## Verify completion

- For training-loop work, verify the `inputs.yaml` success criteria or report
  `PARTIAL` after the maximum pipeline iterations with the limiting evidence.
- For inference-microservice work, require DeepStream evaluation and benchmark
  results, including latency and relevant log findings. Compilation alone is
  insufficient.
- For diagnosis-only requests, do not implement or rerun unless the user also
  authorizes a fix or execution.
- Report which owning skill ran, the artifacts inspected or produced, pass/fail
  status, and any remaining blocker.

