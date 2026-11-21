export const adminNav=[["admin-installation","⚙","Installation Setup"],["admin-users","♙","Users"],["admin-groups","◇","Group Setup"],["admin-group-management","♙","Group Management"],["admin-links","↗","Links"],["admin-pages","▤","Pages"],["admin-esi","↻","ESI Status"],["admin-corp","▣","Corp ESI"],["admin-whitelist","⚙","Whitelist"],["admin-recruitment","✓","Recruitment Settings"],["admin-plugins","◉","Plugins"],["admin-audit","≡","Audit Log"]];
export const pageIcons=Object.fromEntries([...[
  ["overview", "◈", "Overview"],
  ["characters", "♙", "My Characters"],
  ["skills", "▤", "Skills & Queues"],
  ["clones", "◉", "Clones"],
  ["wallet", "◈", "Wallet"],
  ["contracts", "▧", "Contracts"],
  ["standings", "◇", "Standings"],
  ["ratting", "◈", "Ratting"],
  ["market", "◈", "Market"],
  ["mining", "⛏", "Mining"],
  ["industry", "⚒", "Industry"],
  ["blueprints", "▤", "Blueprints"],
  ["plans", "◇", "Skill Plans"],
  ["fittings", "△", "Fittings"],
  ["dens", "⬡", "Mercenary Dens"],
  ["pi", "◎", "Planetary Industry"],
  ["assets", "▦", "Asset Search"],
],...[['corp-overview','◈','Overview'],['corp-members','♙','Memberlist'],['corp-pilots','♙','Roles and Access'],['corp-wallet','◈','Wallet'],['corp-contracts','▧','Contracts'],['corp-assets','▦','Corp Assets'],['corp-search-pilots','⌕','Search Pilots'],['corp-standings','◇','Standings'],['corp-market','◈','Market'],['corp-industry','⚒','Industry'],['corp-blueprints','▤','Blueprints'],['corp-structures','▥','Structures'],['corp-moons','☾','Moon Mining'],['corp-surveys','☷','Moon Surveys']],...adminNav].map(([id,icon])=>[id,icon]));
export const FONT_SIZES={small:0.9,normal:1,large:1.15,"extra-large":1.3};

export const notificationOptions={
 'notify-pi-extractor':'Planetary Industry · extractor programmes finished',
 'notify-den-reinforced':'Mercenary Dens · reinforcement',
 'notify-anarchy':'Mercenary Dens · high anarchy',
 'notify-operation':'Mercenary Dens · tactical operations expiring',
 'notify-empty-training':'Skills · nothing training',
 'notify-training-ending':'Skills · final skill ending soon',
 'notify-industry-ready':'Industry · jobs ready to deliver',
 'notify-market-ended':'Market · expired orders',
 'notify-discord-setup':'Discord · setup reminder',
};
