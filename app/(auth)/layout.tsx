const featureItems = [
  {
    title: "Enterprise Security",
    description: "Your data is protected with enterprise-grade security.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5 19 6v5.3c0 4.4-2.8 7.7-7 9.2-4.2-1.5-7-4.8-7-9.2V6l7-2.5Z" />
        <path d="m9.5 12 1.6 1.6 3.5-3.8" />
      </svg>
    ),
  },
  {
    title: "Role Based Access",
    description: "Granular permissions and role-based access control.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16 11a3.5 3.5 0 1 0-3.4-4.4" />
        <path d="M3.5 20a6 6 0 0 1 12 0" />
        <path d="M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        <path d="M16.5 14.5a5.7 5.7 0 0 1 4 5.5" />
      </svg>
    ),
  },
  {
    title: "Powerful & Simple",
    description: "Powerful features with an intuitive and simple interface.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 19.5h16" />
        <path d="M5 18V5" />
        <path d="m7.5 15 3.5-4 3 2.4 4.5-6" />
      </svg>
    ),
  },
];

function MatrixLogo() {
  return (
    <div className="matrix-auth-logo">
      <div className="matrix-auth-logo-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <span>Matrix CRM</span>
    </div>
  );
}

function SecurityIllustration() {
  return (
    <div className="matrix-auth-art" aria-hidden="true">
      <span className="matrix-art-dot dot-one" />
      <span className="matrix-art-dot dot-two" />
      <span className="matrix-art-dot dot-three" />
      <span className="matrix-art-ring ring-one" />
      <span className="matrix-art-ring ring-two" />

      <div className="matrix-art-phone">
        <div className="matrix-art-phone-notch" />
        <div className="matrix-art-phone-screen">
          <div className="matrix-art-phone-avatar">
            <svg viewBox="0 0 24 24">
              <path d="M12 12.2a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.8 0-7 2.2-7 4.8 0 .8.6 1.3 1.4 1.3h11.2c.8 0 1.4-.5 1.4-1.3 0-2.6-3.2-4.8-7-4.8Z" />
            </svg>
          </div>
          <div className="matrix-art-phone-lines">
            <span />
            <span />
          </div>
          <div className="matrix-art-phone-code">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>

      <div className="matrix-art-bubble">
        <span>****</span>
      </div>

      <div className="matrix-art-envelope">
        <div className="matrix-art-envelope-body">
          <div className="matrix-art-envelope-shield">
            <svg viewBox="0 0 24 24">
              <path d="M12 3.5 19 6v5c0 4.4-2.8 7.7-7 9.2-4.2-1.5-7-4.8-7-9.2V6l7-2.5Z" />
              <path d="M9.5 12v-1.2A2.5 2.5 0 0 1 12 8.3a2.5 2.5 0 0 1 2.5 2.5V12" />
            </svg>
          </div>
        </div>
        <div className="matrix-art-envelope-flap" />
      </div>

      <div className="matrix-art-note">
        <div className="matrix-art-note-icon">
          <svg viewBox="0 0 24 24">
            <path d="M12 3.5 19 6v5.3c0 4.4-2.8 7.7-7 9.2-4.2-1.5-7-4.8-7-9.2V6l7-2.5Z" />
            <path d="m9.5 12 1.6 1.6 3.5-3.8" />
          </svg>
        </div>
        <div>
          <strong>Didn&apos;t receive the code?</strong>
          <p>Check your spam folder or try resending the code again.</p>
        </div>
      </div>
    </div>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="matrix-auth-page">
      <aside className="matrix-auth-sidebar">
        <MatrixLogo />

        <div className="matrix-auth-welcome">
          <h1>
            Welcome to
            <br />
            Matrix CRM
          </h1>
          <p>Secure, reliable and efficient CRM for your organization.</p>
        </div>

        <div className="matrix-auth-features">
          {featureItems.map((item) => (
            <div className="matrix-auth-feature" key={item.title}>
              <div className="matrix-auth-feature-icon">{item.icon}</div>
              <div>
                <h2>{item.title}</h2>
                <p>{item.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="matrix-auth-footer">&copy; 2024 Matrix CRM. All rights reserved.</div>
      </aside>

      <section className="matrix-auth-content">
        <div className="matrix-auth-stage">
          <div className="matrix-auth-card-slot">{children}</div>
          <SecurityIllustration />
        </div>
      </section>
    </main>
  );
}
