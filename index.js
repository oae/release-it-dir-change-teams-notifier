const { Plugin } = require('release-it');
const _ = require('lodash');
const { parseSemVer } = require('semver-parser');
const got = require('got');


class TeamsNotifier extends Plugin {
  get token() {
    const { tokenRef } = this.options;
    return _.get(process.env, tokenRef, null);
  }

  get gitlabApiUrl() {
    const { gitlabApiUrl } = this.options;
    return gitlabApiUrl;
  }

  get webHookUrl() {
    const { webHookUrl } = this.options;
    return webHookUrl;
  }

  get watchDir() {
    const { watchDir } = this.options;
    return watchDir;
  }

  get imageUrl() {
    const { imageUrl } = this.options;
    return imageUrl;
  }

  async afterRelease() {
    const snippetUrl = await this.getDbDiffSnippet();
    if (snippetUrl === null) {
      return;
    }

    const teamsMessage = this.getBaseMessage(snippetUrl);

    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify(teamsMessage);

    if (this.config.isDryRun) {
      this.log.log(JSON.stringify(teamsMessage, null, 2));
      return;
    }

    await got.post(this.webHookUrl, {
      headers,
      body,
    });
  }

  async getDbDiffSnippet() {
    const { tagName, latestTag, repo, name } = this.config.getContext();
    const repository = `https://${repo.host}/${repo.repository}`;
    let dbChange;
    if (this.config.isDryRun) {
      dbChange = await this.exec(`git diff ${latestTag}..HEAD -- ${this.watchDir}`, {
        options: { write: false },
      });
    } else {
      dbChange = await this.exec(`git diff ${latestTag}..${tagName} -- ${this.watchDir}`);
    }

    if (!dbChange || dbChange.trim().length === 0) {
      return null;
    }

    // create snippet on gitlab
    const response = await got.post(`${this.gitlabApiUrl}/snippets`, {
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': this.token,
      },
      body: JSON.stringify({
        title: `DB Change for ${name} between ${latestTag} and ${tagName}`,
        description: repository,
        visibility: 'public',
        files: [
          {
            file_name: 'db_change.patch',
            content: dbChange,
          },
        ],
      }),
    });

    return response.web_url;
  }

  getReleaseType() {
    const { tagName, latestTag } = this.config.getContext();

    const tagSemver = parseSemVer(tagName);
    const newTagSemver = parseSemVer(latestTag);

    if (newTagSemver.major !== tagSemver.major) {
      return 'major';
    } else if (newTagSemver.minor !== tagSemver.minor) {
      return 'minor';
    } else if (newTagSemver.patch !== tagSemver.patch) {
      return 'patch';
    }
  }

  getBaseMessage(snippetUrl) {
    const { tagName, latestTag, name } = this.config.getContext();

    const facts = [];

    facts.push({ name: 'Version', value: `${tagName} (${this.getReleaseType()})` });

    if (latestTag) {
      facts.push({ name: 'Last Release', value: latestTag });
    }

    return {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: '2C5697', // gitlab orange
      summary: `New DB Change detected in ${tagName} for ${name}`,
      sections: [
        {
          activityTitle: `✨✨ A new version for ${name} has been released with changes on db ✨✨`,
          activitySubtitle: snippetUrl,
          activityImage:
            this.imageUrl ||
            'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Gitlab_meaningful_logo.svg/144px-Gitlab_meaningful_logo.svg.png',
          facts,
          markdown: true,
        },
      ],
    };
  }
}

module.exports = TeamsNotifier;
