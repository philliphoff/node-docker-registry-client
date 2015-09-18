#!/usr/bin/env node

/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var vasync = require('vasync');

var drc = require('../../');
var mainline = require('../mainline');


// Shared mainline with examples/foo.js to get CLI opts.
var cmd = 'downloadImg';
mainline({cmd: cmd}, function (log, parser, opts, args) {
    if (!args[0] || (args[0].indexOf(':') === -1 && !args[1])) {
        console.error('usage:\n' +
            '    node examples/v2/%s.js REPO@DIGEST\n' +
            '    node examples/v2/%s.js REPO:TAG\n' +
            '\n' +
            'options:\n' +
            '%s', cmd, cmd, parser.help().trimRight());
        process.exit(2);
    }

    // The interesting stuff starts here.
    var rat = drc.parseRepoAndTag(args[0]);
    console.log('Repo:', rat.canonicalName);
    client = drc.createClientV2({
        scheme: rat.index.scheme,
        name: rat.canonicalName,
        log: log,
        insecure: opts.insecure,
        username: opts.username,
        password: opts.password
    });

    var digest = rat.digest;
    var manifest;
    var slug = rat.localName.replace(/[^\w]+/, '-') + '-' +
        (rat.tag ? rat.tag : rat.digest.slice(0, 12));

    vasync.pipeline({funcs: [
        function getTheManifest(_, next) {
            var ref = rat.tag || rat.digest;
            client.getManifest({ref: ref}, function (err, manifest_) {
                manifest = manifest_;
                next(err);
            });
        },

        function saveTheManifest(_, next) {
            var filename = slug + '.manifest';
            fs.writeFile(filename, JSON.stringify(manifest, null, 4),
                    function (err) {
                if (err) {
                    return next(err);
                }
                console.log('Wrote manifest:', filename);
                next();
            });
        },

        function downloadLayers(_, next) {
            for (var i = 0; i < manifest.fsLayers.length; i++) {
                manifest.fsLayers[i].i = i + 1;
            }
            vasync.forEachParallel({
                inputs: manifest.fsLayers,
                func: function downloadOneLayer(layer, nextLayer) {
                    client.createBlobReadStream({digest: layer.blobSum},
                            function (err, stream, ress) {
                        if (err) {
                            return nextLayer(err);
                        }
                        var filename = format('%s-%d-%s.layer', slug, layer.i,
                            layer.blobSum.split(':')[1].slice(0, 12));
                        var fout = fs.createWriteStream(filename);
                        fout.on('finish', function () {
                            console.log('Downloaded layer %d of %d: %s',
                                layer.i, manifest.fsLayers.length, filename);
                            nextLayer();
                        });
                        stream.on('error', function (err) {
                            nextLayer(err);
                        });
                        fout.on('error', function (err) {
                            nextLayer(err);
                        });
                        stream.pipe(fout);
                        stream.resume();
                    });
                }
            }, next);
        }
    ]}, function (err) {
        client.close();
        if (err) {
            mainline.fail(cmd, err, opts);
        }
    });

if (false) {
    var client, imgId;
    if (args[0].indexOf(':') !== -1) {
        // Lookup by REPO:TAG.
        var rat = drc.parseRepoAndTag(args[0]);
        console.log('Repo:', rat.canonicalName);
        client = drc.createClientV1({
            scheme: rat.index.scheme,
            name: rat.canonicalName,
            log: log,
            insecure: opts.insecure,
            username: opts.username,
            password: opts.password
        });
        client.getImgId({tag: rat.tag}, function (err, imgId_) {
            if (err) {
                mainline.fail(cmd, err, opts);
            }
            imgId = imgId_;
            console.log('imgId:', imgId);
            client.getImgLayerStream({imgId: imgId}, saveStreamToFile);
        });
    } else {
        // Lookup by REPO & IMAGE-ID.
        console.log('Repo:', args[0]);
        client = drc.createClientV1({
            name: args[0],
            log: log,
            insecure: opts.insecure,
            username: opts.username,
            password: opts.password
        });
        imgId = args[1];
        console.log('imgId:', imgId);
        client.getImgLayerStream({imgId: imgId}, saveStreamToFile);
    }

    function saveStreamToFile(getErr, stream) {
        if (getErr) {
            mainline.fail(cmd, getErr);
        }

        var shortId = imgId.slice(0, 12);
        console.log('Downloading img %s layer to "./%s.layer".',
            shortId, shortId);
        console.log('Response headers:');
        console.log(JSON.stringify(stream.headers, null, 4));

        var fout = fs.createWriteStream(shortId + '.layer');
        fout.on('finish', function () {
            client.close();
            console.log('Done downloading image layer.');
            var len = Number(stream.headers['content-length']);
            if (len !== NaN) {
                if (len !== numBytes) {
                    mainline.fail(cmd, format('Unexpected download size: ' +
                        'downloaded %d bytes, Content-Length header was %d.',
                        numBytes, len));
                } else {
                    console.log('Downloaded %s bytes (matching ' +
                        'Content-Length header).', numBytes);
                }
            }
        });

        var numBytes = 0;
        stream.on('data', function (chunk) {
            numBytes += chunk.length;
        });

        stream.on('error', function (err) {
            mainline.fail(cmd, 'error downloading: ' + err);
        });
        fout.on('error', function (err) {
            mainline.fail(cmd, 'error writing: ' + err);
        });

        stream.pipe(fout);
        stream.resume();
    }
}
});
