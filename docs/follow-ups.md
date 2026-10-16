# Follow-ups

- **Core licence note (Architect, Oct 15 2026; fix later):** core's `packages/coding-kernel/src/GitHubCloudIdentitySync.ts` contains denoland/std uuid code but has no licence note (deno std is MIT). Found by the M49 pretrain core-free proof, which flagged 7 denoland/std `uuid/*.ts` docs. Those docs are excluded from pretrain. Fix in core: add the MIT attribution, or replace the copied code with a dependency.
