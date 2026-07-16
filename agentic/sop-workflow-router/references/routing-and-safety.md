# SOP routing and repository safety

## Skill routing

| Goal | Owning skill | Notes |
|---|---|---|
| Regenerate QA data from annotated video | `/sop-data-augmentation` | Supports BCQ, MCQ, GQA, DMCQ, DSQA, and ENQA. |
| Fine-tune the temporal boundary detector | `/sop-ddm-finetuning` | Keep separate from the VLM retry axis. |
| Fine-tune the Cosmos-Reason VLM | `/sop-cr-finetuning` | Keep separate from the DDM retry axis. |
| Evaluate VLM accuracy on pre-segmented clips | `/sop-by-action-eval` | Use for action-level VLM evaluation. |
| Evaluate the full DDM and VLM pipeline | `/sop-e2e-inference` | Use for end-to-end sequence accuracy. |
| Diagnose a failed evaluation | `/sop-rca` | Read artifacts only; do not call services. |
| Run the complete fine-tuning loop | `/sop-ft-orchestrate` | Owns run state, overrides, and iteration budgets. |
| Generate, debug, evaluate, or benchmark DeepStream | `deepstream-sop` | Require accuracy, latency, and log evidence. |
| Build, deploy, and validate the full VSS SOP app | `sop-build` (`/vss-sop-build`) | Owns the four-stage DeepStream, VSS build, deploy, and test pipeline. |

Prefer `/sop-ft-orchestrate` or `/sop-build` whenever a request spans their
stages. Do not reproduce their bookkeeping by hand.

## Repository layout

- `microservices/sop-training-bp/`: training services for data generation,
  DDM training, and Cosmos-Reason training.
- `microservices/sop-inference-bp/`: DeepStream real-time inference reference.
- `agentic/sop-agentic-ft/`: fine-tuning plugins.
- `agentic/ds-sop-skills/`: DeepStream SOP skill.
- `agentic/vss-sop-skills/`: VSS build, deploy, and test skills.

## Shared safeguards

- Never edit `plugins/` during a run. Put changes in
  `<run_dir>/overrides/`.
- Do not run DDM or Cosmos-Reason fine-tuning concurrently with another writer
  targeting the same configuration, checkpoint, or run state.
- Set model, prompt, video, and action-config environment variables for the
  selected dataset and model. Consult
  `agentic/ds-sop-skills/README.md#2-deepstream-sop-microservice-evaluation`
  for the full DeepStream evaluation list.
- If the same agent mistake recurs, produce a retrospective and add the durable
  prevention rule to the repository root `AGENTS.md`, not a plugin skill.

