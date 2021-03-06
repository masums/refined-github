import './latest-tag-button.css';
import React from 'dom-chef';
import cache from 'webext-storage-cache';
import select from 'select-dom';
import tagIcon from 'octicon/tag.svg';
import elementReady from 'element-ready';
import compareVersions from 'tiny-version-compare';
import * as api from '../libs/api';
import features from '../libs/features';
import fetchDom from '../libs/fetch-dom';
import {isRepoRoot} from '../libs/page-detect';
import getDefaultBranch from '../libs/get-default-branch';
import {getRepoURL, getCurrentBranch, replaceBranch, getRepoGQL} from '../libs/utils';

interface Tag {
	name: string;
	commit: string;
}

interface RepoPublishState {
	latestTag: string | false;
	isUpToDate: boolean;
}

const getRepoPublishState = cache.function(async (): Promise<RepoPublishState> => {
	const {repository} = await api.v4(`
		repository(${getRepoGQL()}) {
			refs(first: 20, refPrefix: "refs/tags/", orderBy: {
				field: TAG_COMMIT_DATE,
				direction: DESC
			}) {
				nodes {
					name
					tag: target {
						oid
						... on Tag {
							commit: target {
								oid
							}
						}
					}
				}
			}
			defaultBranchRef {
				target {
					oid
				}
			}
		}
	`);

	if (repository.refs.nodes.length === 0) {
		return {
			latestTag: false,
			isUpToDate: false
		};
	}

	const tags: Tag[] = repository.refs.nodes.map((node: AnyObject) => ({
		name: node.name,
		commit: node.tag.commit?.oid ?? node.tag.oid
	}));

	// Default to the first tag in the (reverse chronologically-sorted) list
	let [latestTag] = tags;

	// If all tags are plain versions, sort them as versions
	if (tags.every(tag => /^[vr]?\d/.test(tag.name))) {
		latestTag = tags.sort((tag1, tag2) => compareVersions(tag1.name, tag2.name)).pop()!;
	}

	return {
		latestTag: latestTag.name,
		isUpToDate: latestTag.commit === repository.defaultBranchRef.target.oid
	};
}, {
	maxAge: 1,
	shouldRevalidate: value => typeof value === 'string',
	cacheKey: () => __featureName__ + ':' + getRepoURL()
});

const getAheadByCount = cache.function(async (latestTag: string): Promise<string> => {
	const tagPage = await fetchDom(`/${getRepoURL()}/releases/tag/${latestTag}`);
	// This text is "4 commits to master since this tag"
	return select('.release-header relative-time + a[href*="/compare/"]', tagPage)!.textContent!.replace(/\D/g, '');
}, {
	maxAge: 1,
	staleWhileRevalidate: 2,
	cacheKey: () => __featureName__ + ':aheadBy:' + getRepoURL()
});

async function init(): Promise<false | void> {
	const {latestTag, isUpToDate} = await getRepoPublishState();
	if (!latestTag) {
		return false;
	}

	const breadcrumb = await elementReady('.breadcrumb');
	if (!breadcrumb) {
		return;
	}

	const currentBranch = getCurrentBranch();
	let href: string;
	if (isRepoRoot()) {
		href = `/${getRepoURL()}/tree/${latestTag}`;
	} else {
		href = replaceBranch(currentBranch, latestTag);
	}

	const link = (
		<a className="btn btn-sm btn-outline tooltipped tooltipped-ne ml-2" href={href}>
			{tagIcon()}
		</a>
	);

	breadcrumb.before(link);
	if (currentBranch !== latestTag) {
		link.append(' ', <span className="css-truncate-target">{latestTag}</span>);
	}

	if (currentBranch === latestTag || isUpToDate) {
		link.setAttribute('aria-label', 'You’re on the latest release');
		link.classList.add('disabled');
		return;
	}

	const defaultBranch = await getDefaultBranch();
	if (currentBranch === defaultBranch) {
		const aheadBy = await getAheadByCount(latestTag);
		link.setAttribute('aria-label', `${defaultBranch} is ${aheadBy} commits ahead of the latest release`);
		link.append(' ', <sup>+{aheadBy}</sup>);
	} else {
		link.setAttribute('aria-label', 'Visit the latest release');
	}
}

features.add({
	id: __featureName__,
	description: 'Adds link to the latest version tag on directory listings and files.',
	screenshot: 'https://user-images.githubusercontent.com/1402241/74594998-71df2080-5077-11ea-927c-b484ca656e88.png',
	include: [
		features.isRepoTree,
		features.isSingleFile
	],
	load: features.nowAndOnAjaxedPages,
	init
});
