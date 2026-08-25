import { DoorBadge } from '@/components/DoorBadge';
export default function StudioHome() {
  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="studio" />
        <h1>The Studio</h1>
        <p className="lede">Invite only. Sign in with your passkey to continue. MFA is required on this door.</p>
      </div>
      <div className="empty"><h4>Authentication arrives with M1 auth routes</h4>
        <p>Draft, review and legal sign-off live here.</p></div>
    </div>
  );
}
