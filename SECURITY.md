# Security Policy

`@bymax-one/nest-subscription` decides, inside a backend, whether an account has paid access. A flaw in it can grant access that was not paid for, or take away access that was. We take vulnerability reports seriously and triage them ahead of feature work.

## Supported versions

The library is a release candidate and no version is published yet. Once one is, only the most recent minor receives security fixes.

## Reporting a vulnerability

**Do not report security issues through public GitHub Issues, Discussions, or pull requests.** Public reports give attackers a window between disclosure and patch deployment.

Use GitHub **Private Vulnerability Reporting**, which is enabled on this repository:

➡️ [Open a private security advisory](https://github.com/bymaxone/nest-subscription/security/advisories/new)

If you cannot use the GitHub form (for example, you do not have an account), email **support@bymax.one** with `[security] @bymax-one/nest-subscription` in the subject line.

### What to include

A useful report contains:

- A clear description of the vulnerability and its impact (confidentiality, integrity, availability)
- Step-by-step reproduction against the latest release, or against the specification while no release exists
- The affected subpath and source adapter
- A suggested fix or mitigation, if you have one
- Whether you would like to be credited in the published advisory, and how

### Response timeline

| Phase                                   | Target                                |
| --------------------------------------- | ------------------------------------- |
| Acknowledgement of receipt              | within **72 hours**                   |
| Initial assessment and severity rating  | within **7 days**                     |
| Coordinated fix for **Critical / High** | within **90 days** of acknowledgement |
| Coordinated fix for **Medium / Low**    | best effort, tracked in advisory      |

We follow [coordinated vulnerability disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure) and publish the advisory only after a fixed version is on npm, unless active exploitation forces an earlier publication.

Reporters are credited in the GitHub Security Advisory and the CHANGELOG entry unless they request anonymity.

## In-scope vulnerabilities

- **Forged or replayed webhooks**: any way to make the library accept a notification that its source did not send, or to apply one twice
- **Access without payment**: any path where a guard allows a request for an account whose source reports no active subscription
- **Cross-account or cross-tenant exposure**: one account reading or changing another's subscription state
- **Secret leakage**: a source credential or webhook secret reaching a log line, an error message or a serialized object
- **Fail-open behaviour**: an outage of the source or of the cache granting access that the configuration says to refuse
- **Bundle supply-chain integrity**: a compromised dependency, a malicious typosquat, a tampered release artifact

## Out of scope

- Misconfigurations in the **consuming application**, unless they reproduce with the documented default configuration
- Issues in a source platform or in an optional peer dependency that the upstream maintainer has already accepted
- Self-XSS, social engineering, denial of service through legitimate authenticated load
- Theoretical attacks without a practical demonstration

## Acknowledgements

We are grateful to the security community and to every reporter who takes the time to investigate and disclose responsibly.
