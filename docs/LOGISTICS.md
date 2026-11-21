# Logistics

Enable Logistics under Admin → Plugins. This creates an approval-based **Logistics** group, visible to members while the plugin is enabled. Members apply under Management → Groups; an administrator approves them through Group Management. Disabling Logistics hides the group from member applications and blocks the plugin; saved settings, requests and group memberships remain for re-enabling.

## Admin settings

Only site admins (including the site owner) can open Management → Logistics → Admin or change its settings. Directors and approved Logistics members do not gain settings access merely through their corporation role or group membership.

Add named locations and choose whether each is a pickup, destination or both. Save the locations and configure maximum cargo volumes for 0.0, Lowsec and Empire (each defaults to 350,000 m³). Route space is chosen by the requester; the site does not infer the travel route or security of every system traversed. Configure a price and collateral rate in ISK per m³. Rates default to zero until configured.

Pilots select From and To, route space and cargo volume. Max fills the selected space limit. Fee estimates and configured collateral round up to whole ISK; the server calculates them using saved rates, validates the route and enforces its limit. When collateral per m³ is zero, the pilot supplies the collateral amount. A request remains awaiting quote until Logistics staff confirm its final fee. Previous requests retain their original locations, estimates and rates when settings change.

## Queues and contracts

All members can submit and view their own requests. Approved Logistics members and site admins can review the request queue and open Pending. Only the request owner accepts a quote; staff record delivery after it happens in EVE.

Pending uses the existing corporation contract sync and scope (`esi-contracts.read_corporation_contracts.v1`). It shows courier contracts assigned to this installation's corporation, with outstanding or in-progress status. Expired outstanding offers and completed, failed, cancelled or unrelated contracts are excluded. Search by pilot, contract or route, or filter Pending/Accepted. The deadline is the offer expiry for pending contracts, or acceptance time plus days to complete for accepted contracts.

No contract is accepted or completed in EVE by these controls. Accept and deliver in-game. Refresh view reads the existing snapshot and normal background refresh; it does not bypass ESI caching. Sync time, refreshing state, retained records and refresh failures are labelled. Requests are not automatically matched or settled against EVE contracts.

For fictional layout checks, set `PREVIEW_LOGISTICS=1` before running `node scripts/preview.mjs`.
