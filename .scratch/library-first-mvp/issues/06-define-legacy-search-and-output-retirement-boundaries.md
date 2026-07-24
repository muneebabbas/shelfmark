Type: grilling
Status: open
Blocked by: 01, 03

# Define legacy search and output retirement boundaries

## Question

Specify the MVP boundary for legacy download-machine controls so the later implementation can remove the right UI and code safely.

Direct search is unavailable in the UI for every user, while an environment-level operator override remains dormant for future work. Normal users do not configure delivery preferences, output modes, per-user destinations, or metadata providers; browser auto-download is not part of the library model. Determine the exact routes, controls, APIs, and settings keys affected by these rules, including what remains admin-only versus what is deleted. Shelfmark is greenfield: no compatibility or data migration path is required.
