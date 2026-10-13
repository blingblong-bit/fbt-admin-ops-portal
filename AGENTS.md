<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- `src/lib/master-dues.ts` is the pure master-dues calculator (previous / current / prepared-renewal buckets with separate status); renewal timing is supplied by the caller from Square-driven progress, never from the stored renewal date alone — keeps money logic testable and stale dates harmless.
