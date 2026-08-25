import { DoorBadge } from '@/components/DoorBadge';
export default function ConsoleHome() {
  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="console" />
        <h1>The Console</h1>
        <p className="lede">Staff and auditors. This door answers only to allow-listed addresses, and MFA is required.</p>
      </div>
      <div className="empty"><h4>Authentication arrives with M1 auth routes</h4>
        <p>Enrolments, entitlements, payments, content pipeline, credentials.</p></div>
    </div>
  );
}
