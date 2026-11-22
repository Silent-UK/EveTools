// Timerboard sharing follows verified corporation membership, not Discord linking.
// Keep this source separate from personal Discord alert/mention eligibility.
export function corporationDenTimers(db,corporationId){
 const saved=db.prepare(`SELECT c.id,s.data,s.updated
  FROM snapshots s JOIN characters c ON c.id=s.character_id
  JOIN users u ON u.id=c.user_id
  JOIN login_membership_checks m ON m.character_id=u.main_id
  WHERE s.kind='dens' AND m.corporation_id=? ORDER BY c.id`);
 return ()=>saved.all(corporationId);
}
