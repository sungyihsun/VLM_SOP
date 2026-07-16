# AGENTS.md — SOP Monitoring Services (Training + Inference)

This file is durable guidance for any coding agent (Claude Code, Codex, etc.)
working in this repo. It does not repeat what's already enforced inside each
skill's `SKILL.md` — it exists to route the agent to the right skill fast and
to state the handful of rules that apply across all of them.

## Repo layout

```
microservices/
  sop-training-bp/     Training BP: data-generation-pipeline, ddm-training-ms,
                        cr-training-ms services. See AGENTIC_README.md here.
  sop-inference-bp/     DeepStream real-time inference BP (reference implementation
                        the deepstream-sop skill generates against).
agentic/
  sop-agentic-ft/       6 plugins driving the training loop (see table below)
  ds-sop-skills/        deepstream-sop: generates/evaluates/benchmarks the
                        DeepStream SOP inference microservice
  vss-sop-skills/       vss-sop-build / -deploy / -test / sop-build: builds VSS
                        on top of the DeepStream microservice
```

## Which skill to use

| Goal | Skill | Notes |
|---|---|---|
| Regenerate QA training data from annotated video | `/sop-data-augmentation` | BCQ/MCQ/GQA/DMCQ/DSQA/ENQA |
| Fine-tune the temporal boundary detector | `/sop-ddm-finetuning` | independent retry axis from VLM |
| Fine-tune the Cosmos-Reason VLM | `/sop-cr-finetuning` | independent retry axis from DDM |
| Check VLM accuracy on pre-segmented clips | `/sop-by-action-eval` | |
| Check full DDM+VLM pipeline accuracy | `/sop-e2e-inference` | |
| Diagnose a failed eval run | `/sop-rca` | reads artifacts only, no service call |
| Run the whole fine-tuning loop unattended | `/sop-ft-orchestrate` | see Prime Directive in its own SKILL.md — do not re-implement its iteration-budget logic elsewhere |
| Generate/debug/benchmark the DeepStream microservice | `deepstream-sop` skill | |
| Build + deploy + validate the full VSS SOP app | `sop-build` skill (`/vss-sop-build`) | 4-stage pipeline: build ds-sop → build VSS → deploy → test |
| Route a cross-skill task or coordinate safe parallel diagnosis | `sop-workflow-router` skill | Repository-wide routing, safety rules, and reusable read-only parallel workflows |

If a task spans more than one of these, prefer letting `/sop-ft-orchestrate`
or `/sop-build` drive it rather than hand-chaining the individual skills —
they already enforce the bookkeeping (run_state.yaml, override policy,
iteration budgets) that hand-chaining would silently drop.

## Cross-cutting rules (apply regardless of which skill is active)

- **`plugins/` is read-only during a run.** Any file that needs a change goes
  through `<run_dir>/overrides/` first — never edit inside `plugins/` directly.
- **Long-running jobs (training, watchdog-monitored evals) run in the
  background** (`run_in_background=true`); don't poll/sleep in a loop.
- **Don't count `eval-only` or `infrastructure` iterations against a fine-tuning
  budget** — only `substantive` (config/retrain) iterations count. This is
  enforced by the orchestrator hook; don't bypass it by calling sub-skills
  directly to dodge the budget.
- **Done means**: for training-loop work, the relevant `success_criteria` in
  `inputs.yaml` (e.g. `seq_accuracy >= X`) are met, or `max_pipeline_iterations`
  is reached with a documented PARTIAL report. For inference-microservice work,
  the `deepstream-sop` eval + benchmark pass and latency figures are reported,
  not just "code compiles."

## Parallel subagents — when it's safe

Use parallel subagents for **read-heavy** work only:
- Evaluating multiple action categories, cameras, or test videos at once
- Reviewing DeepStream pipeline logs / latency traces alongside accuracy eval
- Scanning multiple RCA candidates across DDM vs. VLM vs. augmentation axes

Do **not** parallelize `/sop-cr-finetuning`, `/sop-ddm-finetuning`, or anything
that writes checkpoints/configs — these must stay single-threaded to avoid
two agents racing on the same training config or run_state.yaml.

## Environment specifics

<!-- Fill in per-deployment: GPU pool / model paths / camera IDs / factory site.
     Keep this section short — link to a longer doc instead of pasting everything
     here if it grows past ~15 lines. -->

- `MODEL_ROOT_DIR`, `DDM_MODEL_PATH`, `VLLM_MODEL_PATH`, `VLM_FPS`,
  `VLM_MAX_PIXELS`, `ACTION_CONFIG_PATH`, `VLM_PROMPT_PATH`, `TEST_VIDEO_PATH`
  must be set per the dataset/model in use — see
  `agentic/ds-sop-skills/README.md#2-deepstream-sop-microservice-evaluation`
  for the full list.

## When the agent makes the same mistake twice

Ask it for a retrospective and add the rule here (not inside a `plugins/`
skill file, which is read-only during runs and versioned by the marketplace).
