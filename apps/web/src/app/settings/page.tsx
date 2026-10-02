export default async function SettingsPage() {
  return (
    <div>
      <h1>Settings</h1>
      <section>
        <h2>Providers</h2>
        <p>Managed via API at /api/settings/providers. Raw credentials are never returned.</p>
      </section>
      <section>
        <h2>Publishing</h2>
        <p>
          Managed via API at /api/settings/publishing. The AI disclosure value here is a default
          preference only; the canonical disclosure state lives on each metadata version.
        </p>
      </section>
    </div>
  );
}