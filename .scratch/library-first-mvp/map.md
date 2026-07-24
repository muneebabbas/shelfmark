# Wayfinder Map: Library-First MVP

## Destination

A build-ready MVP specification for a library-first Shelfmark: persistent responsive navigation, `/library` as home, a polished book-detail experience, role-based download/request capabilities, and a simplified user-facing settings surface. It preserves the existing library and request foundations while removing legacy download-machine choices from normal users.

## Notes

- **Domain**: per-user ebook library management. A **download-capable user** may search releases and queue downloads; a **request-only user** may browse, add books, and submit book-level requests. Admins can download and fulfil requests from Activity.
- **Map mode**: planning only. This map produces decisions and a build-ready MVP specification; implementation is separate work after the route is clear.
- **Existing foundations**: reuse Shelfmark's request workflow (admin queue, fulfil/reject, WebSocket updates) rather than create a parallel request system. Replace the existing per-user policy machinery with Library Capability.
- **Navigation**: the persistent left sidebar has Library, Add New, and Settings, in that order, with no nested destination hierarchy. Add New opens the book-add modal. It becomes a top-left-menu drawer on narrow screens. `/library` is the default authenticated route. Activity stays as the existing stateful right-side sidebar, not a navigation destination or full page.
- **Settled constraints**: Direct search is hidden for everyone in the UI, with only an environment-level operator override retained. Find Releases opens automatically only after a successful first add with no global files, carried as one-shot navigation state; all later detail navigation is quiet. Admins fulfil requests in Activity.
- **User settings**: every user may control theme, display name, Kindle address, notification email address, and notification enablement. User notifications are email-only and have one enable/disable switch; their events are request approved, request rejected, and requested book available. Admins control usernames, passwords, and instance configuration. Delivery Preferences, output modes, per-user destinations, and metadata-provider configuration do not belong in a normal user's settings experience.
- **Skills every session should consult**: `/domain-modeling` for capability, request, and settings terminology; `/grilling` for all product decisions. Work later UI decisions against the existing UI or through discussion; do not build standalone in-app prototypes that duplicate the shell.
- **Tracker**: local markdown under `.scratch/library-first-mvp/`. Map = this file. Tickets = `.scratch/library-first-mvp/issues/NN-<slug>.md`.

## Decisions so far

<!-- the index — one line per closed ticket: enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [Reconcile request policy with library-first user capabilities](issues/01-reconcile-request-policy-with-user-capabilities.md) — Replace request-policy settings with an admin-managed two-value Library Capability; book-level Requests are explicit, Book-identified, and shared fulfilment links Files to every requester.
- [Design the persistent library app shell](issues/02-design-persistent-library-app-shell.md) — Keep the existing Activity sidebar; add a persistent Library/Add New/Settings drawer that becomes a top-left-menu drawer on narrow screens.
- [Specify the simplified settings surface](issues/03-specify-simplified-settings-surface.md) — Retain the admin settings shell and instance controls; replace per-user overrides with one explicit self-settings pane, while admins own account access and Library Capability.
- [Define request lifecycle and ownership](issues/08-define-request-lifecycle-and-ownership.md) — Requests exist only while a Book has no Files; they remain pending through a shared download and fulfil atomically when Files become available.
- [Design the polished book-detail experience](issues/04-design-polished-book-detail-experience.md) — Keep a traditional editorial-first detail page, with latest Files by format by default and multi-File releases plus operational actions in an advanced section.

## Not yet specified

- The interaction and visual details that emerge from Activity work.

## Out of scope

- **Author browse.** Deferred completely from the preceding Library map; it needs a fresh effort if reprioritized.
- **Implementation.** This planning map ends with a build-ready specification, not feature branches or production changes.
- **Release-quality reporting and re-requesting another release.** Deferred from this MVP; Requests solve Book availability, not file-quality feedback or release replacement.
