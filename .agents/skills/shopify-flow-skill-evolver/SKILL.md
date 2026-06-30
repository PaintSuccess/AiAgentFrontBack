---
name: shopify-flow-skill-evolver
description: evaluate completed repeatable PaintAccess Shopify operations, propose self-improvement, and create or update local agent skill files for new pipelines. Use after a Shopify operation, automation chain, failure recovery, new tool sequence, recurring user request, or when the user says the agents should learn a workflow. Create or update skills only when the change improves stability, speed, safety, output quality, or repeatability; require human approval before uploading or installing updated skills into live ChatGPT agents.
---

# Shopify Flow Skill Evolver

Use this skill at the end of repeatable Shopify operations, especially when a new pipeline worked and should become reusable.

## Objective

Continuously improve the skill system without creating noise or letting live agents silently rewrite themselves.

## Decision rule

Create or update a skill only if the new information improves at least one:

- stability;
- speed;
- safety;
- output quality;
- repeatability;
- reduction of user clarification loops.

If not, do not change production skills.

## Evaluation Workflow

1. Summarize the completed operation:
   - goal;
   - inputs;
   - tools used;
   - successful path;
   - failed/blocked attempts;
   - final state.
2. Determine whether the flow is repeatable.
3. Check whether an existing skill already covers it.
4. Decide:
   - no change;
   - update existing skill;
   - create new skill;
   - add backlog observation.
5. If changing skills, keep edits minimal and specific.
6. Validate the local skill folder.
7. Report the exact files changed and the live-agent upload/install status.
8. Preserve safety constraints.

## Self-Improvement Workflow

When a new repeatable pipeline appears:

1. Extract the trigger phrases, required inputs, expected outputs, tool sequence, approval gates, and rollback/test behavior from the completed run.
2. Search `.agents/skills` for the closest existing skill.
3. Prefer updating an existing narrow skill when the new behavior is a variant of an existing workflow.
4. Create a new skill only when the workflow has distinct triggers, reusable steps, and no clear owner skill.
5. For a new skill:
   - use a short lowercase hyphenated folder name;
   - create `SKILL.md`;
   - create `agents/openai.yaml`;
   - add `references/` only when the body would otherwise become too long or template-heavy.
6. For an existing skill:
   - update only the needed workflow, routing, template, or safety rule;
   - avoid broad rewrites.
7. Run validation:
   - `python "C:\Users\GLuK Laptop\.codex\skills\.system\skill-creator\scripts\quick_validate.py" "<skill-folder>"` when Python is available;
   - run repo build only when backend/frontend runtime code changed.
8. Commit and push only when the user asked for repo changes to be deployed or the current task requires live backend/agent source updates.
9. Update live ChatGPT agent skill attachments separately. A repo commit does not automatically update uploaded ChatGPT skill copies unless the agent reads from the repo directly.

## Live Agent Rule

Never assume local skill file edits are active in ChatGPT agents. After changing `.agents/skills`, do one of these:

- upload/update the skill copies in each target ChatGPT agent;
- report that the live agent upload is still pending and name the affected agent(s);
- if the UI blocks edits, report the blocker and keep the browser tab for handoff.

Do not let an agent silently create a new live skill and start using it without Daniel/user approval. The agent may propose and create local files, but live installation/upload is approval-gated.

## Update criteria

Update an existing skill when:

- a new failure mode was discovered;
- a safer identification step is needed;
- a tool sequence was proven to work;
- a template should be standardized;
- orchestration routing should change.

Create a new skill when:

- the flow is distinct;
- it will recur;
- no existing skill covers it clearly;
- it has concrete triggers and outputs.

## Output Format

When this skill runs, report:

- decision: no change, update existing skill, create new skill, or backlog only;
- reason and rubric score;
- files created or changed;
- validation result;
- live agent status: updated, pending upload, blocked, or not needed;
- follow-up test prompt for the agent if a workflow should be verified.

## Do not update when

- the task was one-off;
- the new detail is customer-specific only;
- the change is merely wording preference;
- the skill would become too broad.

See `references/skill-update-decision-rubric.md`.
