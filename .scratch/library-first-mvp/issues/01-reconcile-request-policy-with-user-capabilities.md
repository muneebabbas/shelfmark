Type: grilling
Status: open
Blocked by:

# Reconcile request policy with library-first user capabilities

## Question

Define the canonical capability model for the MVP and reconcile it with Shelfmark's existing per-user request-policy system.

A download-capable user may search releases and queue downloads. A request-only user may browse, add books, and submit only book-level requests; they never see indexer/release selection. Admins can download and fulfil requests. Decide the durable representation, migration from the current policy modes, permission boundaries for every relevant API/action, and how an admin's fulfilment links a selected release back to the request and requester.

The outcome must state whether the existing policy model is simplified, wrapped, or retained internally, and define the terms used by every later ticket.
