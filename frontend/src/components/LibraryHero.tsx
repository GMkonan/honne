import { useEffect, useState } from "react";

export interface PublicProfile {
  name: string;
  avatarUrl: string;
}

interface LibraryHeroProps {
  profile: PublicProfile;
  profileLoading: boolean;
  collectionLoading: boolean;
  totalTitles: number;
  inProgress: number;
}

export function LibraryHero(
  {
    profile,
    profileLoading,
    collectionLoading,
    totalTitles,
    inProgress,
  }: LibraryHeroProps,
) {
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => setAvatarFailed(false), [profile.avatarUrl]);

  const displayName = profileLoading ? "Your library" : profile.name;
  const showAvatar = !profileLoading && profile.avatarUrl && !avatarFailed;

  return (
    <section
      className="library-hero"
      aria-labelledby="library-profile-name"
      aria-busy={profileLoading || collectionLoading}
    >
      <div className="hero-overlay" />
      <div className="page-container hero-content">
        <div className="profile-mark">
          {showAvatar
            ? (
              <img
                src={profile.avatarUrl}
                alt={`${profile.name} profile`}
                onError={() => setAvatarFailed(true)}
              />
            )
            : (
              <span
                role="img"
                aria-label={profileLoading
                  ? "Loading Library profile"
                  : `${profile.name} default profile mark`}
              >
                本音
              </span>
            )}
        </div>
        <div className="hero-copy">
          <span className="hero-kicker">
            {profileLoading ? "LOADING PROFILE" : "PERSONAL LIBRARY"}
          </span>
          <h1 id="library-profile-name">{displayName}</h1>
          <dl className="hero-stats">
            <div>
              <dt>Total titles</dt>
              <dd>{collectionLoading ? "—" : totalTitles}</dd>
            </div>
            <div>
              <dt>In progress</dt>
              <dd>{collectionLoading ? "—" : inProgress}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
