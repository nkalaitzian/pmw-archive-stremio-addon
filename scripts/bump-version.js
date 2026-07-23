const fs = require("fs");
const path = require("path");
const readline = require("readline");

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

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function formatSemver(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

function incrementSemver(version, type) {
  const current = parseSemver(version);

  if (type === "major") {
    return formatSemver({ major: current.major + 1, minor: 0, patch: 0 });
  }

  if (type === "minor") {
    return formatSemver({ major: current.major, minor: current.minor + 1, patch: 0 });
  }

  if (type === "patch") {
    return formatSemver({ major: current.major, minor: current.minor, patch: current.patch + 1 });
  }

  throw new Error(`Unsupported increment type: ${type}`);
}

async function selectIncrementType() {
  const answer = (await ask("Increment which part? (major/minor/patch): ")).toLowerCase();

  if (answer !== "major" && answer !== "minor" && answer !== "patch") {
    throw new Error("Invalid selection. Please choose 'major', 'minor', or 'patch'.");
  }

  return answer;
}

async function main() {
  const packagePath = path.join(__dirname, "..", "package.json");
  const addonPath = path.join(__dirname, "..", "addon.js");

  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const addonSource = fs.readFileSync(addonPath, "utf8");
  const addonVersionMatch = addonSource.match(/version:\s*"([^"]+)"/);

  if (!addonVersionMatch) {
    throw new Error("Could not read version from addon.js manifest.");
  }

  const addonVersion = addonVersionMatch[1];
  const packageVersion = packageJson.version;

  if (packageVersion !== addonVersion) {
    throw new Error(
      `Version mismatch: package.json=${packageVersion} addon.js=${addonVersion}. Sync them before bumping.`
    );
  }

  const incrementType = await selectIncrementType();
  const nextVersion = incrementSemver(packageVersion, incrementType);

  const confirmation = await ask(
    `Update version ${packageVersion} -> ${nextVersion} in package.json and addon.js only? (y/N): `
  );

  if (!isYes(confirmation)) {
    console.log("Version bump cancelled.");
    process.exit(0);
  }

  packageJson.version = nextVersion;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  const updatedAddonSource = addonSource.replace(
    /version:\s*"([^"]+)"/,
    `version: "${nextVersion}"`
  );
  fs.writeFileSync(addonPath, updatedAddonSource, "utf8");

  console.log(`Updated version to ${nextVersion} in package.json and addon.js.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
