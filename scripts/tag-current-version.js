const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execSync } = require("child_process");

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function isYes(value) {
  return ["y", "yes"].includes(String(value).toLowerCase());
}

function verifyTagDoesNotExist(tagName) {
  try {
    execSync(`git rev-parse --verify refs/tags/${tagName}`, { stdio: "ignore" });
    console.error(`Tag ${tagName} already exists locally.`);
    process.exit(1);
  } catch {
    // Expected when tag does not exist.
  }
}

function verifyRemoteTagDoesNotExist(tagName) {
  try {
    const out = execSync(`git ls-remote --tags origin refs/tags/${tagName}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();

    if (out) {
      console.error(`Tag ${tagName} already exists on origin.`);
      process.exit(1);
    }
  } catch {
    // If remote check fails, continue and let push surface the real failure.
  }
}

async function main() {
  const packagePath = path.join(__dirname, "..", "package.json");
  const addonPath = path.join(__dirname, "..", "addon.js");

  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const addonSource = fs.readFileSync(addonPath, "utf8");
  const addonVersionMatch = addonSource.match(/version:\s*"([^"]+)"/);

  if (!addonVersionMatch) {
    console.error("Could not read version from addon.js manifest.");
    process.exit(1);
  }

  if (pkg.version !== addonVersionMatch[1]) {
    console.error(
      `Version mismatch: package.json=${pkg.version} addon.js=${addonVersionMatch[1]}. Bump first to sync them.`
    );
    process.exit(1);
  }

  const tagName = `v${pkg.version}`;
  verifyTagDoesNotExist(tagName);
  verifyRemoteTagDoesNotExist(tagName);

  const confirmation = await ask(
    `About to create and push tag ${tagName}. Continue? (y/N): `
  );

  if (!isYes(confirmation)) {
    console.log("Tag operation cancelled.");
    process.exit(0);
  }

  execSync(`git tag ${tagName}`, { stdio: "inherit" });
  execSync(`git push origin ${tagName}`, { stdio: "inherit" });
  console.log(`Created and pushed tag ${tagName}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
