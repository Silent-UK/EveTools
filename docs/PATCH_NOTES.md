# EveTools v1.0.1

- Share reinforced Mercenary Den timers for verified corporation members on the site and, when enabled, the Discord Timerboard. Owners do not need a Discord link for shared timer visibility; existing alert mention and access rules are preserved.
- Add independent Discord alerts and channels for Structure Anchoring, Moon Ready to Fracture and Moon Fractured. Distinguish manual and automatic fractures, retain retries and avoid duplicate or obsolete alerts.
- Add Structure Destroyed alerts for confirmed corporation structure and Mercenary Den losses, including structures removed from the current inventory. Ordinary disappearance, transfer and ship losses do not count as destruction.
- Add Pilot joined corporation alongside Pilot left corporation, with independent settings, safe initial baselines and shared roster reads.
- Arrange Discord Notifications into six compact rows: Dens, Structures, Moons, Pilots, Groups and Fuel, with up to three columns and responsive layouts.
- Preserve generic installation defaults, existing saved settings, private data boundaries and the empty bundled moon survey catalogue.

Back up your database and existing encryption key before updating. New notification types are off until configured. No additional EVE scopes are introduced; alerts use existing saved notification syncs. This release does not include the separate public demo or bypass normal SSO.

# EveTools v1.0.0 - Logistics location finder

- Search synced corporation structures, known courier locations, configured locations and public NPC stations from Logistics Admin.
- Select a result to fill its name and numeric location ID automatically, enriching existing rows instead of duplicating them.
- Support station aliases such as Jita 4-4; keep manual entry for unknown private structures and preserve admin-only settings access.

# EveTools v1.0.0 - Isotope courier pricing and hauler workflow

- Configure directional isotope quantities and ISK-per-isotope costs. Isotope mode calculates the courier reward from fuel only, without a volume surcharge or site quote request.
- Automatically refresh corporation-assigned courier snapshots while Logistics is enabled, respecting ESI caches; show matched route fuel costs alongside actual rewards.
- Add exclusive hauler Claim, Release and Complete actions and completed history. Distinguish locally recorded delivery from ESI-verified completion.
- Preserve legacy volume pricing, cargo limits, admin-only settings and approval-based Logistics access.

# EveTools v1.0.0

Initial public release of EveTools: self-hosted pilot and corporation management built around EVE SSO and ESI.

- Pilot dashboards, linked mains/alts, skills and queues, industry slots, fittings and skill plans, assets, wallets, contracts, PI and Mercenary Dens.
- Corporation profiles, members and access, structures with fittings, fuel and gas, projects, industry, assets and moon survey/production tools.
- Timerboard with targets, calendar recurrence, reinforcement/attack/anchoring alerts and Dashboard action queues.
- Optional Discord, SRP, Buyback and Logistics plugins, group approvals, recruitment, announcements and audit logs.
- Installation-owned identity, startup configuration validation, generic hosting templates and setup/backup instructions.
- No live accounts, credentials, tokens, databases or corporation moon-scan records are included. Import your own surveys.

Derived from STEMP Tools v0.46.145. The STEMP and NARVI installations retain their independent version histories.
