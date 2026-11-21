export const homeCategories=[
 {id:'announcements',label:'Corporation Announcements',icon:'▤',open:true},
 {id:'attacks',label:'Structures Under Attack',icon:'⚔',tone:'danger',open:true},
 {id:'anchoringDrills',label:'Anchoring Moon Drills',icon:'☾',tone:'warning',open:true},
 {id:'reinforcedDrills',label:'Reinforced Moon Drills',icon:'☾',tone:'danger',open:true},
 {id:'reinforcedOffices',label:'Reinforced Customs Offices',icon:'◎',tone:'danger',open:true},
 {id:'reinforced',label:'Reinforced Dens',icon:'⬡',tone:'danger',open:true},
 {id:'corpReinforced',label:'Reinforced Structures',icon:'▥',tone:'danger',open:true},
 {id:'upcomingTimers',label:'Timerboard Reinforcements',icon:'◷',tone:'danger',open:true},
 {id:'needsAction',label:'Needs your action',icon:'✓',tone:'warning',open:true},
 {id:'srp',label:'Ship Replacement',icon:'◇',open:true},
 {id:'buyback',label:'Buyback',icon:'◈',open:true},
 {id:'fuel',label:'Fuel & Gas',icon:'◈',tone:'warning'},
 {id:'extractions',label:'Moon Extractions',icon:'☾',tone:'green'},
 {id:'corpContracts',label:'Corporation Contracts',icon:'▧'},
 {id:'calendar',label:'Calendar Events',icon:'▦'},
 {id:'skills',label:'Skill Queues',icon:'▤'},
 {id:'pi',label:'Planetary Industry',icon:'◎',tone:'green'},
 {id:'denMtos',label:'Den Tactical Operations',icon:'⬡'},
 {id:'couriers',label:'Courier Deadlines',icon:'▧'},
 {id:'completedContracts',label:'Completed Contracts',icon:'✓',tone:'green'},
 {id:'market',label:'Fulfilled Market Orders',icon:'◈',tone:'green'}
];

export const homePreference=id=>'home-show-'+id;
export const homePreferenceKeys=new Set(homeCategories.map(category=>homePreference(category.id)));
