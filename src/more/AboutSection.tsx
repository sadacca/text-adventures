import { LICENSES } from './licenses';

/**
 * Task 1.9: about/licenses screen. Native <details>/<summary> for the expandable full
 * text — no extra state or dependency needed for something this simple.
 */
export function AboutSection() {
  return (
    <section>
      <h2>About</h2>
      <div className="settings-card about-card">
        <p className="about-blurb">
          Text Adventures plays Z-machine story files entirely in your browser — story files, saves,
          and maps stay on this device and are never uploaded anywhere.
        </p>
        <p className="about-blurb">
          Every story is interpreted by <strong>Bocfel</strong> (MIT license, Chris Spiegel),
          compiled to WebAssembly. Licenses for it and every other library this app is built on are
          below.
        </p>
        {LICENSES.map((entry) => (
          <details key={entry.name} className="license-entry">
            <summary>
              <span className="license-name">{entry.name}</span>
              <span className="license-badge">{entry.license}</span>
            </summary>
            <p className="license-role">{entry.role}</p>
            <pre className="license-text">{entry.text}</pre>
          </details>
        ))}
      </div>
    </section>
  );
}
