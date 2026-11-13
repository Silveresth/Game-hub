// Construit l'application Android (APK) : synchronise la configuration Capacitor, puis Gradle.
// Usage : SAM_GAME_URL=https://jouer.mondomaine.fr npm run android:apk
//  - toujours : APK de test (signé avec la clé de débogage de cette machine), à installer directement sur un téléphone ;
//  - si android/keystore.properties existe : APK et AAB de publication signés avec votre clé (voir docs/MOBILE.md).
// Les fichiers sont copiés dans dist-apk/.
import { execSync } from 'node:child_process';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const url = (process.env.SAM_GAME_URL ?? 'https://steal-a-masterpiece.onrender.com').replace(/\/+$/, '');
const gradle = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
const release = existsSync(join('android', 'keystore.properties'));
const version = /versionName "([^"]+)"/.exec(await readFile(join('android', 'app', 'build.gradle'), 'utf8'))?.[1] ?? 'dev';

console.log(`Adresse du jeu dans l'application : ${url}/game/`);
execSync('npx cap sync android', { stdio: 'inherit', env: { ...process.env, SAM_GAME_URL: url } });
const tasks = ['assembleDebug', ...(release ? ['assembleRelease', 'bundleRelease'] : [])];
// Gradle se lance depuis le dossier du projet Android
execSync(`${gradle} ${tasks.join(' ')} --no-daemon`, { stdio: 'inherit', cwd: 'android', env: process.env });

await mkdir('dist-apk', { recursive: true });
const out = join('android', 'app', 'build', 'outputs');
const copies = [
  [join(out, 'apk', 'debug', 'app-debug.apk'), `steal-a-masterpiece-${version}-test.apk`],
  ...(release
    ? [
        [join(out, 'apk', 'release', 'app-release.apk'), `steal-a-masterpiece-${version}.apk`],
        [join(out, 'bundle', 'release', 'app-release.aab'), `steal-a-masterpiece-${version}.aab`],
      ]
    : []),
];
for (const [from, name] of copies) {
  if (!existsSync(from)) continue;
  await copyFile(from, join('dist-apk', name));
  console.log(`→ dist-apk/${name}`);
}
if (!release) console.log('(Pas de android/keystore.properties : seule la version de test est construite. Voir docs/MOBILE.md pour la version à publier.)');
