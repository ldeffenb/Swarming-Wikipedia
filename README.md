# Swarming-Wikipedia
A TypeScript-based tool to upload a Wikipedia snapshot to the swarm, limited only by the size of your stamp, not the size of the snapshot.  This 
tool was written for the [We Are Millions](https://www.wearemillions.online/) ([Fair Data Society](https://fairdatasociety.org/)) Hackathon bounty 
"Best upload of Wikipedia mirror to Swarm" ([github](https://github.com/fairdatasociety/wam/issues/18) and [gitcoin](https://gitcoin.co/issue/fairdatasociety/wam/18/100027844)) 
in partnership with [Kiwix](https://www.kiwix.org/).

## DISCLAIMER
This software is provided to you "as is", use at your own risk and without warranties of any kind.
It is your responsibility to read and understand how Swarm works and the implications of running this software.
The usage of this tool involves various risks, including, but not limited to:
damage to hardware or loss of funds associated with the Ethereum account connected to your node.
No developers or entity involved will be liable for any claims and damages associated with your use,
inability to use, or your interaction with other nodes or the software.

## Installing

The Swarming-Wikipedia tool is designed to be built into and executed from a Docker container file.  To prepare the tool for use:

1. `git clone https://github.com/ldeffenb/Swarming-Wikipedia.git`
2. `cd Swarming-Wikipedia`
3. `docker build --tag swarming-wikipedia .`

## Usage

`docker run swarming-wikipedia <WikipediaArchiveURL> <beeNodeURL> <usableStampBatch>`

where:

- `WikipediaArchiveURL` is the URL for a Wikipedia Archive .ZIM file to push to the swarm
- `beeNodeURL` is the URL for a suitable bee node's API port
- `usableStampBatch` is the stamp batch to pay for the upload

You can select any Wikipedia Archive from the [kiwix.org master list](https://download.kiwix.org/zim/wikipedia/).  The following URL 
is the required one to use for the We Are Millions bounty.

[wikipedia_bm_all_maxi_2022-02.zim](https://download.kiwix.org/zim/wikipedia/wikipedia_bm_all_maxi_2022-02.zim)

If you are running a bee node on IP address `192.168.10.8`, then `beeNodeURL` could be `http://192.168.10.8:1633`.  Remember, this URL 
must be accessible to a process running inside the Docker container, so it is likely that neither `http://127.0.0.1:1633` nor 
`http://localhost:1633` will work.

You can verify a `stampBatch` usability with something like the following command (assuming your bee node is running on `192.168.10.8` 
and has the default Debug API address enabled).  For information on purchasing stamps, see 
[here](https://docs.ethswarm.org/docs/access-the-swarm/keep-your-data-alive).

`curl http://192.168.10.8:1635/stamps | jq`

The Swarming-Wikipedia tool will provide some status feedback as it executes.  The time required will depend mostly on the size 
of the .ZIM file being pushed to the swarm.  When the tool has finished, a final log line similar to the following will be shown.  The 
URL in this log can be used to access the uploaded archive from the node through which it was uploaded.

`View your archive at http://192.168.10.8:1633/bzz/9aafea948007399891290fc3b294fdfbbf7f51313111dd20ba2bb6ff2a1ecd27`

Note that due to propagation variations in the swarm, a freshly uploaded archive may not be immediately accessible from other 
nodes in the swarm.  If you encounter errors accessing the archive, wait a while to give the upload time to propagate.  Or you 
can poll the tag information using something like the following command which is also displayed when the tool has finished the upload.

`curl http://192.168.10.8:1633/tags/2577402878 | jq`

## Technical Description

The Swarming-Wikipedia tool works at a high level by doing the following via get-and-swarm-archive.sh

1. Use wget to download the specified zimURL to archive.zim
2. Use [zimdump](https://github.com/openzim/zim-tools) to extract archive.zim to the archive subdirectory
3. Activate node.js to execute a compiled TypeScript which does the actual uploading

The Swarming-Wikipedia TypeScript then does the following

1. Count all files located in the archive subdirectory simultaneously building an index for A/-resident files
2. Create a tag to track upload and pusher progress.  This tag is visible on the top line as the upload happens.
3. Upload each of those files using the [/bytes](https://docs.ethswarm.org/api/#tag/Bytes/paths/~1bytes/post) API via [axios](https://github.com/axios/axios)
4. Dynamically build a mantaray manifest using [mantaray-js](https://github.com/ethersphere/mantaray-js)
5. When all files have been uploaded, the accumulated manifest is then uploaded also using the [/bytes](https://docs.ethswarm.org/api/#tag/Bytes/paths/~1bytes/post) API via [axios](https://github.com/axios/axios)
6. When everything is complete, the final collection reference URL is displayed

## Special Considerations

- Swarming-Wikipedia requires a local bee node to avoid size restrictions on the gateway
- [mantaray-js](https://github.com/ethersphere/mantaray-js) is used to allow for larger collections than the typical [tar-based collection uploads](https://docs.ethswarm.org/api/#tag/BZZ/paths/~1bzz/post)
- [Axios](https://github.com/axios/axios) was used to allow the API connection to the bee node to be kept alive.  Repeated use of the [bee-js](https://github.com/ethersphere/bee-js) uploadData API generates many TIME_WAIT sockets as a new connection is created for each API invocation.
- Any extension-less file for which Content-Type cannot be determined is assumed to be text/html if it is located in the A subdirectory.
- All files are stored with their original name and unmodified content.  The Content-Type is only indicated in the generated swarm manifest.
- A custom index-redirect.html or master-index.html is created in the root of the collection and set as the default file to both redirect to A/index (assumed to be the actual archive entry point) and present a generated list of linked articles.
- "Special" characters are handled in the file names to ensure linkability from the generated index as well as to provide a better humanly-readable presentation of the link.  This is more visible with [wikipedia_en_100_maxi_2022-03.zim](https://download.kiwix.org/zim/wikipedia/wikipedia_en_100_maxi_2022-03.zim).
- Files that zimdump puts into the _exceptions directory are added as references to their originally specified directory.  This happens when the archive contains a file and a directory that share the same name.  I'm not 100% certain that swarm's manifest handles this properly, but I do it anyway.
- All uploaded chunks are pinned in the uploading node, so the entire collection should always be visible via the /bzz URL at that node.
- The tool (without zimdump and directly executing the [TS component](src/index.ts)) can also upload any arbitrary directory tree of files to the swarm, with a code-able default entry point which defaults to index.html.
- For advanced interest, there is code in the tool that can dump the contents of a mantaray manifest from the swarm, again using just the [TS component](src/index.ts).

## License

This tool is distributed under the BSD 3-Clause License found in the [LICENSE](LICENSE) file.

## Acknowledgements

The author is indebted to (at least):

- https://www.docker.com/blog/getting-started-with-docker-using-node-jspart-i/
- https://stackoverflow.com/questions/40873165/use-docker-run-command-to-pass-arguments-to-cmd-in-dockerfile
- https://stackoverflow.com/questions/4341630/checking-for-the-correct-number-of-arguments
- https://wiki.openzim.org/wiki/OpenZIM

and of course to my long time supporting the development of the [swarm](https://docs.ethswarm.org/docs/)!

## Technical Debt (ToDos)

- Error handling is practically non-existant.  Be careful to supply valid arguments when running the container.
- Extremely large collections may result in large memory consumption as the manifest is constructed in RAM before being saved to the swarm.  It is possible, although non-trivial, to construct and save partial manifests and combine them later without holding them concurrently in RAM.
- Upload performance can be increased by paralleling requests.  However, this comes with an increased risk of exceeding the time settlements and actually needing to issue cheques to pay for push data transfers.
- The /bytes API defaults to deferred uploads.  If a non-deferred upload is selected, then the tool would not complete until the required chunks have been initially distributed to the swarm.
- The tool is very non-modular (read: a single source file).  It could be modularized for readability and re-use.
- Better styling of the generated index of A/ documents (currently hard-coded at 3 columns)
- Remove redundancy of mis-speeled (sic) redirect files in the generated index
- Use of zimlib rather than zimdump might make a few things easier to accomplish, but the bounty specified using zimdump.

## Build hints

- `npm install` then `npm run build` if you want to use it outside of docker
- If you get errors about browserslist being out of date, try `export BROWSERSLIST_IGNORE_OLD_DATA=true`
- If you get errors about unsupported digital envelope routines, try `export NODE_OPTIONS=--openssl-legacy-provider`
