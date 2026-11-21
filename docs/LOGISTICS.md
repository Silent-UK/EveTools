# Logistics

Enable Logistics under Admin → Plugins. This creates an approval-based **Logistics** group, visible to members while the plugin is enabled. Members apply under Management → Groups; an administrator approves them through Group Management. Disabling Logistics hides the group from member applications and blocks the plugin; saved settings, requests and group memberships remain for re-enabling.

## Admin settings

Only site admins (including the site owner) can open Management → Logistics → Admin or change its settings. Directors and approved Logistics members do not gain settings access merely through their corporation role or group membership.

Add named locations and choose whether each is a pickup, destination or both. Save the locations and configure maximum cargo volumes for 0.0, Lowsec and Empire (each defaults to 350,000 m³). Route space is chosen by the requester; the site does not infer the travel route or security of every system traversed. Configure a price and collateral rate in ISK per m³. Rates default to zero until configured.

Pilots select From and To, route space and cargo volume. Max fills the selected space limit. Fee estimates and configured collateral round up to whole ISK; the server calculates them using saved rates, validates the route and enforces its limit. When collateral per m³ is zero, the pilot supplies the collateral amount. A request remains awaiting quote until Logistics staff confirm its final fee. Previous requests retain their original locations, estimates and rates when settings change.

## Queues and contracts

All members can submit and view their own requests. Approved Logistics members and site admins can review the request queue and open Pending. Only the request owner accepts a quote; staff record delivery after it happens in EVE.

Pending uses the existing corporation contract sync and scope (`esi-contracts.read_corporation_contracts.v1`). It shows courier contracts assigned to this installation's corporation, with outstanding or in-progress status. Expired outstanding offers, failed, cancelled and unrelated contracts are excluded from the active queue. Claimed couriers that finish remain in Completed history. Search by pilot, contract or route, or filter Pending/Accepted. The deadline is the offer expiry for pending contracts, or acceptance time plus days to complete for accepted contracts.

No contract is accepted or completed in EVE by these controls. Accept and deliver in-game. Refresh view reads the existing snapshot and normal background refresh; it does not bypass ESI caching. Sync time, refreshing state, retained records and refresh failures are labelled. Legacy quote requests are not automatically settled against EVE contracts.

For fictional layout checks, set `PREVIEW_LOGISTICS=1` before running `node scripts/preview.mjs`.

## Isotope-only courier pricing

Under Logistics → Admin, choose **Isotope cost only**. Add a directional pickup/destination route, total isotopes consumed for that journey, and ISK per isotope. The reward is `ceil(isotopes × ISK per isotope)` in whole ISK. Cargo volume enforces the route-space limit and calculates configured collateral; it does not increase the hauling reward. Configure the reverse direction separately. A route with no price shows a warning rather than inventing a quote.

Pilots select locations and use the **Courier fuel calculator**, then create the courier in EVE addressed to the corporation with that reward and appropriate collateral. No site quote request is needed in this mode. Volume/quoted-fee pricing and previous requests remain available for installations using the older workflow. Optional numeric station/structure IDs on locations let the queue match ESI locations even when the displayed names differ; otherwise exact names are matched without case sensitivity. Matching routes display their current fuel cost alongside the actual EVE reward, flagging a difference without altering the contract.

## Hauler assignment and completion

Approved Logistics members and site admins use **Pending → Claim** to reserve a courier. Claims are exclusive. Only its assigned account can Release or Complete it. Complete asks the hauler to confirm delivery in EVE, moves it out of the active queue and retains it under the Completed filter. A local completion is labelled **awaiting ESI confirmation** until the corporation snapshot reports `finished`. ESI-finished claimed couriers appear completed automatically. Tools never accepts, delivers or pays an EVE contract on the pilot's behalf.

While enabled, Logistics checks corporation contracts in the background every minute and refreshes its shared snapshot after about five minutes, subject to ESI response caching, scope availability and failures. The open Pending tab refreshes every minute while visible and outside active input editing. Cached data, update timestamps and failures remain labelled. Expired offers and non-courier/outbound contracts are excluded. Claims and completion records persist across settings changes and plugin disable/re-enable.

## Find a station or structure

Logistics → Admin → **Find station or structure** searches by name, system or numeric location ID. It combines current corporation structures, locations already resolved from corporation courier history, configured locations and 5,210 public NPC station references from CCP SDE. Aliases such as `Jita 4-4` are supported. Click **Use location** to fill the name and ID, then Save settings. Matching existing rows are filled instead of duplicated. Search remains site-admin-only and does not grant haulers access to settings.

Search does not call a global private-structure directory or require additional scopes. Sync corporation structures first to discover your citadels. Unknown private structures can still be entered manually; their visibility through ESI depends on the connected character's access. POS, moon drills and known non-docking corporation structures are excluded from the courier finder. Station reference data can be rebuilt using `python3 scripts/build-station-locations.py /path/to/ccp-sde-jsonl.zip`.
