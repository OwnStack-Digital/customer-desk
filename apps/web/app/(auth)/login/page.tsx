import { Icon } from "../../../components/icon";
import { Brand } from "../../../components/ui";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — OwnStack" };

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand />
        <div className="login-story-content">
          <p className="eyebrow">LESS ADMIN. MORE BUSINESS.</p>
          <h1>
            A little order.
            <br />A lot more
            <br />
            <em>headspace.</em>
          </h1>
          <p>
            Customer conversations, thoughtful replies and clear quotes.
            Together in one calm workspace.
          </p>
          <div className="login-feature">
            <span>
              <Icon name="inbox" />
            </span>
            <div>
              <strong>Every conversation, organised.</strong>
              <small>Know what needs your attention.</small>
            </div>
          </div>
          <div className="login-feature">
            <span>
              <Icon name="spark" />
            </span>
            <div>
              <strong>A helpful first draft.</strong>
              <small>You review. You approve. You stay in control.</small>
            </div>
          </div>
        </div>
        <p className="login-story-footer">
          Built for the business behind the inbox.
        </p>
      </section>
      <section className="login-form-section">
        <div className="login-card">
          <span className="login-welcome-icon">
            <Icon name="leaf" size={28} />
          </span>
          <p className="eyebrow">WELCOME BACK</p>
          <h2>
            Make room for
            <br />
            what matters.
          </h2>
          <p className="login-intro">
            Sign in to manage your customer conversations.
          </p>
          <LoginForm />
          <p className="login-security">
            <Icon name="shield" size={16} />
            Secure owner access to your workspace
          </p>
        </div>
        <p className="login-footer">
          OwnStack BOS · Business, a little simpler.
        </p>
      </section>
    </main>
  );
}
