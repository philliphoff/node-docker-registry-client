#!/usr/bin/env node

/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var docker = require('../');

var repo = 'library/mongo';
docker.createRegistrySession({repo: repo}, function (err, sess) {
    if (err) {
        console.error(err.message);
        return;
    }
    sess.listRepoTags(function (err, repoTags) {
        var latest = repoTags['latest'];
        sess.getImgAncestry({imgId: latest}, function (err, ancestry) {
            if (err) {
                console.error(err.message);
                return;
            }
            console.log(JSON.stringify(ancestry, null, 4));
        });
    });
});