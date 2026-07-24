Type: task
Status: ready-for-agent
Blocked by:

# Implement the persistent library app shell

## Question

Implement [Design the persistent library app shell](02-design-persistent-library-app-shell.md) in the existing authenticated application frame. Make `/library` the default authenticated route while preserving the existing Activity control and stateful right-side Activity sidebar across navigation.

Add the persistent desktop left sidebar with `Library`, `Add New`, and `Settings`, in that order. `Add New` opens the metadata-provider-backed Book-add modal and is not a route. On narrow screens, hide the left navigation behind one top-left menu button that opens the same drawer. Do not add a bottom navigation bar, icon rail, duplicate header, Activity route, or full-page Activity view.

## Acceptance criteria

- Authenticated root/default navigation reaches `/library`; direct links and the existing login return-to behavior remain intact.
- Desktop renders the ordered persistent left navigation and narrow layouts use the top-left menu drawer.
- `Add New` opens the existing Book-add flow without exposing the retired direct-search language or route.
- Navigation between Library and Settings leaves the existing Activity drawer's open/closed state and socket-driven behavior intact.
- Responsive and route tests cover the shell behavior without introducing a parallel app frame.

## References

- [Persistent shell decision](02-design-persistent-library-app-shell.md)
- [Existing library routing and Activity foundations](../../library/issues/07-frontend-routing-contract.md)
