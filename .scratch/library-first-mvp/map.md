# Wayfinder Map: Library-First MVP

## Destination

A build-ready MVP specification for a library-first Shelfmark: persistent responsive navigation, `/library` as home, a polished book-detail experience, role-based download/request capabilities, and a simplified user-facing settings surface. It preserves the existing library and request foundations while removing legacy download-machine choices from normal users.

## Notes

- **Domain**: per-user ebook library management. A **download-capable user** may search releases and queue downloads; a **request-only user** may browse, add books, and submit book-level requests. Admins can download and fulfil requests from Activity.
- **Map mode**: planning only. This map produces decisions and a build-ready MVP specification; implementation is separate work after the route is clear.
- **Existing foundations**: reuse Shelfmark's request workflow (`request_book`, admin queue, fulfil/reject, WebSocket updates) rather than create a parallel request system. The final capability contract must reconcile this with the existing per-user policy machinery.
- **Navigation**: the persistent sidebar has Library, Activity, and Settings, with no nested destination hierarchy. It collapses for narrow screens. `/library` is the default authenticated route. Search is a modal entry point, not the home page.
- **Settled constraints**: Direct search is hidden for everyone in the UI, with only an environment-level operator override retained. Find Releases opens automatically only after a successful first add with no global files, carried as one-shot navigation state; all later detail navigation is quiet. Admins fulfil requests in Activity.
- **User settings**: every user may control theme, display name, Kindle address, notification email address, and notification enablement. User notifications are email-only and have one enable/disable switch; their events are request approved, request rejected, and requested book available. Admins control usernames, passwords, and instance configuration. Delivery Preferences, output modes, per-user destinations, and metadata-provider configuration do not belong in a normal user's settings experience.
- **Skills every session should consult**: `/domain-modeling` for capability, request, and settings terminology; `/grilling` for all product decisions; `/prototype` for app-shell, activity, or detail-page interaction decisions.
- **Tracker**: local markdown under `.scratch/library-first-mvp/`. Map = this file. Tickets = `.scratch/library-first-mvp/issues/NN-<slug>.md`.

## Decisions so far

<!-- the index — one line per closed ticket: enough to judge relevance, then zoom the link for the detail the ticket holds -->

## Not yet specified

- The concrete request lifecycle and ownership rules once the capability model is reconciled with the existing request-policy machinery.
- Exact settings/data migration and deletion boundaries after the retained user/admin settings contract is settled.
- The interaction and visual details that emerge from the app-shell, Activity, and book-detail prototypes.

## Out of scope

- **Author browse.** Deferred completely from the preceding Library map; it needs a fresh effort if reprioritized.
- **Implementation.** This planning map ends with a build-ready specification, not feature branches or production changes.
