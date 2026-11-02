# Security policy

## Supported versions

Only the live site, https://fault-lines-atlas.vercel.app, built from the `main` branch, gets security fixes.

## Reporting a vulnerability

Please don't report security problems in a public issue, a pull request or a discussion.

1. Use GitHub's private reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Only the maintainers can see the report.
2. If that button is not available, open an issue that says only that you have a security report and asks for a private channel, with no details. You can also reach the repository owner through their GitHub profile, https://github.com/muradalshorman987.

Helpful things to include: what an attacker could do, the steps or a link that shows it, and the browser you used. We aim to reply within a week and will tell you when a fix is live. With your permission, we'll credit you in the fix's notes.

## What matters most here

The atlas is a static site with no server, accounts or database. These are the places where a weakness would hurt readers:

- **The Ask Claude panel and your API key.** Ask Claude uses the visitor's own Anthropic API key. The key stays in your browser: it is held in memory for the visit, or in this browser's local storage only if you tick "remember on this device". It is sent only to Anthropic's API (`api.anthropic.com`), never to us, and it is never put in a URL or a log. The site's Content Security Policy only allows connections to the site itself, Anthropic's API and the map tile hosts. Anything that could read or leak a stored key, such as script injection (XSS) through data, answers or share links, is a serious bug. Please report it privately.
- **Rendering of data and answers.** Text from the data files and from Claude's answers must always render as text, never as HTML.
- **The automated workflows.** The weekly data workflow opens pull requests and must never push to `main` or expose its tokens.

Problems in third-party services (Anthropic's API, the map tile providers, Vercel or GitHub) should go to those services.

## Never commit secrets

- Never put an API key, token or password in the repository, in an issue or in a pull request, including in screenshots and logs.
- The workflows read their keys from GitHub Actions secrets (for example `EIA_API_KEY` for the data pipeline). They are never written to files.
- To use a key on your own computer (for example to run the data pipeline), set it as an environment variable in your shell. Don't write it into any file inside the repository.
- If you commit a secret by mistake, **revoke it first** at the service that issued it, then tell us. Removing it from the Git history is not enough, because copies may already exist.
