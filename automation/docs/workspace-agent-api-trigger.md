# Workspace Agent API Trigger

This document records what can and cannot be automated through the Workspace Agents API.

## Current API boundary

Workspace Agents can be triggered from an API after the agent has been created and published with an API channel.

The public Workspace Agents API is for triggering published agent runs. It is not currently a full management API for creating, configuring, uploading skills, connecting apps, setting authentication, or updating agent definitions.

That means:

- create/configure agents in ChatGPT agent builder;
- version the intended configuration in this repository under `workspace-agents/`;
- use API triggers to start saved agents from external systems;
- update the agent manually in the builder when the spec changes, until a management API exists.

## API trigger setup

In ChatGPT:

1. Open the Workspace Agent builder.
2. Add an API channel.
3. Create a Workspace Agent access token in ChatGPT Admin -> Access tokens.
4. Select the Workspace Agents scope.
5. Store the token in a secrets manager.
6. Trigger the published agent from your backend/scheduler.

The API queues the run. It does not currently return the full agent response synchronously to the caller.

## Recommended PaintAccess use

Use API triggers for:

- Shopify webhook received;
- external scheduler event;
- Make/Zapier/Trigger.dev job;
- custom Operations Desk backend event;
- internal admin button: "Run order sweep now".

Do not use API trigger as a replacement for agent setup. It starts an already-configured workflow.

## Config-as-code pattern

Keep these YAML files as the source of intended configuration:

- `workspace-agents/paintaccess-operations-desk.yaml`
- `workspace-agents/paintaccess-admin-setup.yaml`
- `workspace-agents/paintaccess-readonly-monitor.yaml`

When changing the agent:

1. Update the YAML spec.
2. Update related skills/docs if needed.
3. Apply the same change manually in the ChatGPT agent builder.
4. Test the agent.
5. Commit and push the spec change.

## Future automation path

If OpenAI exposes a Workspace Agent management API later, these YAML files can become the input to a deployment script that creates/updates agents automatically.
