export function DoorBadge({ door }) {
  const label = { dojo: 'The Dojo', studio: 'The Studio', console: 'The Console' }[door];
  return <span className="door">{label}</span>;
}
