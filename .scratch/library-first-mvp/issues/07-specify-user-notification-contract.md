Type: grilling
Status: open
Blocked by: 01, 03

# Specify the user notification contract

## Question

Define the notification contract that fits the library-first MVP and reconcile it with Shelfmark's existing notification machinery.

For regular users, delivery is email only, configured with an email address distinct from the Kindle address, and controlled by one enable/disable switch rather than per-event preferences. The only user-visible events are request approved, request rejected, and requested book available (the requested book now has actual files). Decide the exact event-to-state-transition mappings, whether admins need a separate event surface under this MVP, API/settings shape, and how existing irrelevant user notification choices are removed or migrated. Role relevance is mandatory: a non-admin must never subscribe to events such as new request submitted.
