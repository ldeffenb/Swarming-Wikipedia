import { Bee, Tag, Utils } from '@ethersphere/bee-js'

import { MantarayNode } from 'mantaray-js'
import { loadAllNodes } from 'mantaray-js'
import type { Reference, StorageLoader, StorageSaver } from 'mantaray-js'
import { initManifestNode, NodeType } from 'mantaray-js'

import * as FS from 'fs/promises'
import PATH from 'path'
import { resolve, relative } from 'path';
import { readdir } from 'fs/promises';
import { Dirent } from 'fs';

const axios = require('axios')
axios.default
const http = require('http');
const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 1000 });

const nsTestnet1 = { beeUrl: 'http://192.168.10.172:1633',
				beeDebugUrl: 'http://192.168.10.172:1635',
				batchID: "c749612363aa9f0345041e24b54e6d177285148ac78356a6b33e468d6b418995" }

const oldLaptopBee6 = { beeUrl: 'http://192.168.174.61:1533',
				beeDebugUrl: 'http://192.168.10.174:1535',
				batchID: "7efb6d7be447cccafd3139407abd4a430e153f17d36084401c623d934532fdcf" }

const useNode = nsTestnet1

const beeUrl = useNode.beeUrl
const beeDebugUrl = useNode.beeDebugUrl
const batchID = useNode.batchID

const bee = new Bee(beeUrl)

let tagID = 0
let progress = ''

var exitRequested = false

function specificLocalTime(when : Date)
{
	return when.toLocaleTimeString('en-GB')	// en-GB gets a 24hour format, but amazingly local time!
}

function currentLocalTime()
{
	return specificLocalTime(new Date())
}

function showTopLine(text : string)
{
	text = currentLocalTime()+' '+text
	// Save cursor, Home cursor, text, Erase to end of line, Restore cursor
	process.stderr.write('\u001b7'+'\u001b[H'+text+'\u001b[K'+'\u001b8')	
}

function showSecondLine(text : string)
{
	text = currentLocalTime()+' '+text
	// Save cursor, Home cursor, Down line, text, Erase to end of line, Restore cursor
	process.stderr.write('\u001b7'+'\u001b[H'+'\u001bD'+text+'\u001b[K'+'\u001b8')
}

function showError(text : string)
{
	//process.stderr.clearLine(1);
	console.error(currentLocalTime()+' '+text)
}

function showLog(text : string)
{
	console.log(currentLocalTime()+' '+text)
}

function showBoth(text : string)
{
	showLog(text)
	showError(text)
}

function printStatus(text : string)
{
	showLog(text)
}

const hexToBytes = (hexString: string): Reference => {
  return Utils.Hex.hexToBytes(hexString)
}

const bytesToHex = (data: Uint8Array | undefined): string => {
  if (!data) return "*undefined*"
  return Utils.Hex.bytesToHex(data)
}

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

var mime = require('mime-types')

function contentType(path:string):string {
	var mimeType = mime.lookup(path)
	if (!mimeType) {
		mimeType = mime.lookup('.bin')
		if (!mimeType) mimeType = 'application/octet-stream'
	}
	return mime.contentType(mimeType)
}

var utf8ArrayToStr = (function () {
    var charCache = new Array(128);  // Preallocate the cache for the common single byte chars
    var charFromCodePt = String.fromCodePoint || String.fromCharCode;
    var result = Array<string>();
	const hasFromCodePoint = (typeof String.fromCodePoint == 'function');

    return function (array: Uint8Array) {
        var codePt, byte1;
        var buffLen = array.length;

        result.length = 0;

        for (var i = 0; i < buffLen;) {
            byte1 = array[i++];

            if (byte1 <= 0x7F) {
                codePt = byte1;
            } else if (byte1 <= 0xDF) {
                codePt = ((byte1 & 0x1F) << 6) | (array[i++] & 0x3F);
            } else if (byte1 <= 0xEF) {
                codePt = ((byte1 & 0x0F) << 12) | ((array[i++] & 0x3F) << 6) | (array[i++] & 0x3F);
            } else if (hasFromCodePoint) {
                codePt = ((byte1 & 0x07) << 18) | ((array[i++] & 0x3F) << 12) | ((array[i++] & 0x3F) << 6) | (array[i++] & 0x3F);
            } else {
                codePt = 63;    // Cannot convert four byte code points, so use "?" instead
                i += 3;
            }

            result.push(charCache[codePt] || (charCache[codePt] = charFromCodePt(codePt)));
        }

        return result.join('');
    };
})();

type gotFile = {
	fullPath: string,
	entry: Dirent,
}

async function* getFileEntries(dir: string): AsyncGenerator<gotFile> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const res = resolve(dir, entry.name);
		yield {fullPath: res, entry: entry}
    }
}

async function* getFiles(dir: string): AsyncGenerator<string> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const res = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            yield* getFiles(res);
        } else {
            yield res;
        }
    }
}

async function executeAPI(URL : string, API : string, method : string = 'get', params : string = '', headers : string = '', body : string = '')
{
	if (params != '') params = '/'+params
	
	var actualURL = URL+'/'+API+params
	var doing = method+' '+actualURL

	var start = new Date().getTime()
	
	try
	{
		//showError('Starting '+doing)
		//var response = await axios({ method: method, url: actualURL, headers: headers, data: body })
		var response = await axios({ method: method, url: actualURL, headers: headers, data: body, httpAgent: httpAgent })
	}
	catch (err:any)
	{
		var elapsed = Math.trunc((new Date().getTime() - start)/1000+0.5)
		if (err.response)
		{	//showError(actualURL)
			showError(doing+' '+elapsed+' response error '+err+' with '+JSON.stringify(err.response.data))
			//showError(JSON.stringify(err.response.data))
		} else if (err.request)
		{	showError(doing+' '+elapsed+' request error '+err)
			//showError(JSON.stringify(err.request))
		} else
		{	showError(doing+' '+elapsed+' other error '+err)
			//showError(JSON.stringify(err))
		}
		throw(err);
		return void(0)
	}
	var elapsed = Math.trunc((new Date().getTime() - start)/1000+0.5)
	//showError(actualURL+' response.data='+JSON.stringify(response.data))
	//showError(doing+' '+elapsed+' response.data='+JSON.stringify(response.data))

	return response.data
}

var runMonitor = true
async function monitorTag(ID : number) : Promise<boolean> {
	showLog(`Monitoring tag ${ID}`)
	var lastTag
	var lastText
	var nextTime
	while (runMonitor) {
		if (tagID != ID) {
			showBoth(`Monitoring tag ${ID} exiting, tagID=${tagID}`)
			break
		}
		try {
			const tag = await bee.retrieveTag(ID)
			const text = `TAG ${ID} ${tag.synced}/${tag.processed}/${tag.total} p:${tag.total-tag.processed} s:${tag.processed-tag.synced}`
			if (!lastTag || !lastText || lastText != text) {
				showTopLine(text)
				lastText = text
				lastTag = tag
			}
			if (!nextTime || new Date() >= nextTime) {
				showLog(`${progress} ${text}`)
				nextTime = new Date((new Date()).getTime() + 1*60000);
			}
			await sleep(1000)
			showSecondLine(progress)
		}
		catch (err) {
			showError(`monitorTag: ${err}`)
			await sleep(10000)
		}
	}
	if (lastText) showBoth(`Done Monitoring ${ID} ${lastText}`)
	return true
}

function logDeltaTag(what: string, startTag: Tag, endTag: Tag) {
	var text = `${what} total:${endTag.total-startTag.total} proc:${endTag.processed-startTag.processed} sync:${endTag.synced-startTag.synced}`
	showLog(text)
	showError(text)
}

async function countManifest(node: MantarayNode, prefix: string = '', indent: string = ''): Promise<number> {
	var count = 0
	if (node.forks) {
		for (const [key, fork] of Object.entries(node.forks)) {
			var newPrefix = prefix+utf8ArrayToStr(fork.prefix)
			count += await countManifest(fork.node, newPrefix, indent+'  ')
		}
	}
	
	count++
	if (node.isWithPathSeparatorType()) {
		const heap = process.memoryUsage()
		progress = `Count ${prefix} rss:${Math.floor(heap.rss/1024/1024)}MB heap:${Math.floor(heap.heapUsed/1024/1024)}/${Math.floor(heap.heapTotal/1024/1024)}MB`
		showSecondLine(progress)
		printStatus(`${indent} ${prefix} => ${count} Node`)
	}
	return count
}

type SaveManifestReturn = {
	reference: Reference,
	count: number,
}

type SaveManifestCounts = {
	processed: number,
	total: number,
}

async function saveManifest(storageSaver: StorageSaver, node: MantarayNode, prefix: string = '', indent: string = '', counts: SaveManifestCounts|undefined = undefined): Promise<SaveManifestReturn> {

	if (!counts) {
		counts = { processed: 0, total: await countManifest(node) }
	}

	var myCount = 0
	//let promiseArray = [];
	if (node.forks) {
		for (const [key, fork] of Object.entries(node.forks)) {
			const newPrefix = prefix+utf8ArrayToStr(fork.prefix)
			
//	if (node.isValueType()) types = types + "Value ";
//	if (node.isEdgeType()) types = types + "Edge ";
//	if (node.isWithPathSeparatorType()) types = types + "Separator ";
//	if (node.IsWithMetadataType()) types = types + "Meta ";
			//if (fork.node.isWithPathSeparatorType())
			//	promiseArray.push(await saveManifest(storageSaver, fork.node, newPrefix, indent+'  ', counts))
			//else promiseArray.push(saveManifest(storageSaver, fork.node, newPrefix, indent+'  ', counts))
			const { reference, count } = await saveManifest(storageSaver, fork.node, newPrefix, indent+'  ', counts)
			myCount += count
		}
	}
	
	var ref = await node.save(storageSaver)
	if (counts) counts.processed++
	myCount++
	
	const heap = process.memoryUsage()
	progress = `rss:${Math.floor(heap.rss/1024/1024)}MB heap:${Math.floor(heap.heapUsed/1024/1024)}/${Math.floor(heap.heapTotal/1024/1024)}MB`
	if (counts && counts.total > 0 && counts.processed > 0) {
		const didPercent = Math.floor(counts.processed / counts.total * 10000)/100
		progress = `Save ${prefix} ${didPercent}% or ${counts.processed}/${counts.total} ${progress}`
	}

	if (node.isWithPathSeparatorType()) {
		showSecondLine(progress)
		printStatus(`${indent} ${prefix} => ${bytesToHex(ref)} Node`)
		//showLog(`${indent} ${prefix} => ${bytesToHex(ref)} Node ${progress}`)
	}

	return { reference: ref, count: myCount }
}






async function storeFileAsPath(fullPath : string, posixPath : string, rootNode : MantarayNode|undefined, coverageCallback?: (z:number, x:number, y:number) => void) {
	var mimeType = contentType(fullPath)
	const content = await FS.readFile(fullPath)
	const stats = await FS.stat(fullPath)
	const modified = stats.mtime
	let lastModified = modified.toUTCString()
	let metaData = { "Content-Type": mimeType, "Filename": PATH.basename(fullPath), "Last-Modified": lastModified }

	if (coverageCallback) {
		if (posixPath.slice(-4).toLowerCase() == '.png') {
			showError(`Need To Parse ${posixPath} for coverageCallback`)
			//coverageCallback(posixPath)
		}
	}
	
	printStatus(`adding ${fullPath} as ${posixPath} type:${mimeType} modified:${lastModified}`);
	const reference = await uploadData(content, posixPath, true)

	const entry = bytesToHex(reference)
	//await saveTile(undefined, fullPath, modified, entry)

	//if (entries.has(entry)) {
	//	var usage = (entries.get(entry)!)+1
	//	entries.set(entry,usage);
	//}
	//else {
	//	entries.set(entry,1);
	//}
	
	if (rootNode) {
		//showBoth(`adding rootNode Fork for ${fullPath}->${posixPath} reference ${bytesToHex(reference)}`)
		rootNode.addFork(new TextEncoder().encode(posixPath), reference, metaData)
	}
	//else showBoth(`NOT adding Fork for ${fullPath}->${posixPath} reference ${bytesToHex(reference)}`)
}

async function storeFile(fullPath : string, rootNode : MantarayNode|undefined, rootPath : string, coverageCallback?: (z:number, x:number, y:number) => void) {
	
	const relPath = relative(rootPath,fullPath)
	const posixPath = relPath.split(PATH.sep).join(PATH.posix.sep)
	
	const stats = await FS.stat(fullPath)
	const modified = stats.mtime
	//const prevModified = await getMetaModified(fullPath)
	//if (prevModified && prevModified.getTime() === modified.getTime()) {
	//	printStatus(`Skipping ${fullPath} ${modified}, already stored!`)
	//	if (rootNode) {
	//		const mimeType = contentType(fullPath)
	//		const lastModified = modified.toUTCString()
	//		const metaData = { "Content-Type": mimeType, "Filename": PATH.basename(fullPath), "Last-Modified": lastModified }
	//		const reference = await getMetaReference(fullPath)
	//		//showBoth(`adding rootNode Fork for ${fullPath}->${posixPath} DB reference ${bytesToHex(reference)}`)
	//		if (reference) rootNode.addFork(new TextEncoder().encode(posixPath), hexToBytes(reference), metaData)
	//	}
	//	return	// No need to process this one!
	//}
	
	return storeFileAsPath(fullPath, posixPath, rootNode, coverageCallback)
}

async function addFile(node: MantarayNode, sourcePath: string, filePath: string)
{
	
	const stats = await FS.stat(filePath)
	const modified = stats.mtime
	const modifiedUTC = modified.toUTCString()
	
	const relPath = relative(sourcePath,filePath)
	const posixPath = relPath.split(PATH.sep).join(PATH.posix.sep)
	var mimeType = contentType(relPath)
	
	if (mimeType == 'application/octet-stream') {
		if (posixPath.slice(0,2) == 'A/')
			mimeType = 'text/html'
		else if (posixPath.slice(0,2) == 'M/')
			mimeType = 'text/plain'
	}
	
	const content = await FS.readFile(filePath)
	let metaData = { "Content-Type": mimeType, "Filename": PATH.basename(relPath) }

	//let lastModified = ''
	//if (file.modified > 0) {
	//	lastModified = new Date(utcModified*1000).toUTCString()
		Object.assign(metaData, { "Last-Modified": modifiedUTC })
	//}
	showLog(`adding ${posixPath} type:${mimeType} modified:${modifiedUTC}`);

	const reference = await uploadData(content, relPath, true)
	node.addFork(new TextEncoder().encode(posixPath), reference, metaData)
}


async function newManifest(storageSaver: StorageSaver, sourcePath: string, index: string|undefined = undefined) : Promise<string> {
	
	const startTag = await bee.createTag()
	tagID = startTag.uid

	showBoth(`Creating manifest from ${sourcePath} using tag ${tagID} at ${startTag.startedAt}`)

	//const node = initManifestNode()	// Only if you want a random obfuscation key
	const node = new MantarayNode()
	
	if (index) {
		if (index != "index.html") {	// Probably only need to do this if there's a separator in index...
			const redirect = `index-redirect.html`
			const indexRef = await uploadData(`<script>location.replace('${index}')</script>`, redirect, true)
			node.addFork(new TextEncoder().encode(redirect), indexRef)
			index = redirect
		}

		const rootMeta = { "website-index-document": index }
		node.addFork(new TextEncoder().encode('/'), hexToBytes(zeroAddress), rootMeta)

		const rootFork = node.getForkAtPath(new TextEncoder().encode('/'))
		const rootNode = rootFork.node
		let type = rootNode.getType
		type |= NodeType.value
		type = (NodeType.mask ^ NodeType.withPathSeparator) & type
		rootNode.setType = type
	}
	
	await (async () => {
	  for await (const f of getFiles(sourcePath)) {
	    printStatus(`queueing ${f}`)
	    showLog(`queueing ${f}`)
		await addFile(node, sourcePath, f)
	  }
	})()
	
	await sleep(1000)

	const middleTag = await bee.retrieveTag(tagID)

	showBoth(`Saving manifest`)
	printStatus(`Saving manifest`);

	runMonitor = true
	const monTag = monitorTag(tagID)
	
	var start = new Date().getTime()
	//var refCollection = await node.save(storageSaver)
	var refCollection = (await saveManifest(storageSaver, node)).reference
	var elapsed = Math.trunc((new Date().getTime() - start)/1000+0.5)
	
	showBoth(`Final ${sourcePath} collection reference ${bytesToHex(refCollection)} in ${elapsed}s`)
	
	const endTag = await bee.retrieveTag(tagID)

	logDeltaTag('manifest create', startTag, middleTag)
	logDeltaTag('manifest save', middleTag, endTag)
	logDeltaTag('manifest total', startTag, endTag)
	
	runMonitor = false
	await monTag

	return bytesToHex(refCollection)
}





const zeroAddress = '0000000000000000000000000000000000000000000000000000000000000000';

async function printAllForks(storageLoader: StorageLoader, node: MantarayNode, reference: Reference|undefined, prefix: string, indent: string, what: string, filter: string|undefined, excludes: string[]|undefined, manifestOnly: Boolean, loadFiles: Boolean, saveFiles: Boolean): Promise<void> {

	if (!reference) return
	
	if (exitRequested) return
	
	try {
		//await isRetrievable(bytesToHex(reference), `node(${prefix})`)
		await node.load(storageLoader, reference)
	}
	catch (err) {
		var badAddr = bytesToHex(reference)
		showBoth(`printAllForks: Failed to load ${prefix} address ${badAddr} ${err}`);
		return
	}

	var types = "";
	if (node.isValueType()) types = types + "Value ";
	if (node.isEdgeType()) types = types + "Edge ";
	if (node.isWithPathSeparatorType()) types = types + "Separator ";
	if (node.IsWithMetadataType()) types = types + "Meta ";
	
	var address = node.getContentAddress;
	var addrString = "";
	if (address) addrString = bytesToHex(address);
	//showLog(`${indent}type:x${Number(node.getType).toString(16)} ${types} prefix:${prefix} content:${addrString}`)

	printStatus(`${indent}type:x${Number(node.getType).toString(16)} ${types} prefix:${prefix} content:${addrString}`);

	//var reference = bytesToHex(node.getReference)
	//if (reference != zeroAddress)
	//	console.log(`${indent}reference:${reference}`)
	var obfuscation = bytesToHex(node.getObfuscationKey)
	//if (obfuscation != zeroAddress)
	//	showLog(`${indent}obfuscation:${obfuscation}`)


	var entry = bytesToHex(node.getEntry)
	if (entry != zeroAddress) {
		//showLog(`${indent}entry:${entry}`)
		printStatus(`${indent}type:x${Number(node.getType).toString(16)} ${types} prefix:${prefix} entry:${entry}`);
		
		//if (loadFiles && what && what != "") {
		//	pendingFiles.push({prefix: prefix, reference: entry});
		//}
	}

	if (node.IsWithMetadataType() && node.getMetadata) {
		var meta = ""
		for (const [key, value] of Object.entries(node.getMetadata)) {
			meta = meta + key + ":" + value + " "
		}
		showLog( `${indent}metadata: ${meta}` )
	}
	
	if (exitRequested) return

	if (!node.forks) return
	//const promiseArray = [];
	for (const [key, fork] of Object.entries(node.forks)) {
		var newPrefix = prefix+utf8ArrayToStr(fork.prefix)
		if (filter && filter != '') {
			const checkLen = Math.min(newPrefix.length, filter.length)
			if (newPrefix.slice(0,checkLen) == filter.slice(0,checkLen)) {
				if (checkLen < filter.length) {
					showLog(`printAllForks:recursing ${newPrefix} for ${filter}`)
					await printAllForks(storageLoader, fork.node, fork.node.getEntry, newPrefix, indent+'  ', what, filter, excludes, manifestOnly, loadFiles, saveFiles)
					continue
				}
				else showBoth(`printAllForks:Satisfied ${filter} with ${newPrefix} ${bytesToHex(fork.node.getEntry)}`)
			} else {
				showLog(`printAllForks:Ignoring ${newPrefix} NOT ${filter}`)
				continue
			}
		}
		if (excludes && excludes.length > 0) {
			let found = false;
			for (const exclude of excludes) {
				if (newPrefix.length >= exclude.length) {
					if (newPrefix.slice(0,exclude.length) == exclude) {
						showBoth(`printAllForks:Excluding ${newPrefix}`)
						found = true
						break
					}
				}
			}
			if (found) continue
		}
		//showLog(`${indent}Fork[${key}] prefix ${newPrefix} ${bytesToHex(fork.node.getEntry)}`)
		//if (fork.node.isValueType() && !fork.node.isEdgeType()) {	// Handle value (non-edge) nodes first to resolve files quicker
		//	if (!manifestOnly) {
		//		pendingValues.push({node: fork.node, prefix: newPrefix, indent: indent+'  ', excludes: excludes})	// Enough pendingFiles backlog, queue to the end
		//	//} else {
		//	//	//showLog(`${indent}Fork[${key}] Skipping ValueType prefix ${newPrefix} ${bytesToHex(fork.node.getEntry)}`)
		//	//	checkFiles++
		//	}
		//}
		//else pendingNodes.push({node: fork.node, prefix: newPrefix, indent: indent+'  ', excludes: excludes});
		await printAllForks(storageLoader, fork.node, fork.node.getEntry, newPrefix, indent+'  ', what, filter, excludes, manifestOnly, loadFiles, saveFiles)
	}
	//await Promise.all(promiseArray)
}


async function dumpManifest(storageLoader: StorageLoader, reference: string, what: string, filter: string|undefined = undefined, excludes: string[]|undefined, manifestOnly = false, loadFiles: Boolean = true, saveFiles: Boolean = false) : Promise<MantarayNode> {

	var start = new Date().getTime()
	showLog(`dumpManifest:${what} from ${reference} ${filter}`)

	const node = new MantarayNode()
	await printAllForks(storageLoader, node, hexToBytes(reference), '', '', what, filter, excludes, manifestOnly, loadFiles, saveFiles)

	var elapsed = Math.trunc((new Date().getTime() - start)/1000+0.5)
	showBoth(`dumpManifest:${what} ${filter} in ${elapsed} seconds`)
	
	return node
}

async function uploadData(content: Uint8Array | string, what: string, pin: boolean) : Promise<Reference> {
	//const [value, release] = await semaphorePutContent.acquire();
	showBoth(`uploadData ${what} ${content.length} bytes`)
	var start = new Date().getTime()
	try {
		var reference = await bee.uploadData(batchID, content, {pin: pin, tag: tagID})
	}
	catch (err) {
		showBoth(`uploadData ${what} ${content.length} bytes failed with ${err}`)
		await sleep(15000)
		try {
			var reference = await bee.uploadData(batchID, content, {pin: pin, tag: tagID})
		}
		catch (err) {
			showBoth(`uploadData ${what} RETRY ${content.length} bytes failed with ${err}`)
			throw err
		}
	}
	finally {
		//release();
	}
	var elapsed = Math.trunc((new Date().getTime() - start)/100+0.5)/10.0
	if (elapsed >= 2)
		showError(`uploadData ${what} ${content.length} bytes took ${elapsed}s, ref:${reference}`)
	return hexToBytes(reference)
}

const saveFunction = async (data: Uint8Array): Promise<Reference> => {
	//const [value, release] = await semaphoreManifestSaves.acquire();
	try {
		const hexRef = await bee.uploadData(batchID, data, {pin: true, tag: tagID})
		return hexToBytes(hexRef)
	}
	catch (err) {
		showBoth(`saveFunction ${data.length} bytes failed with ${err}`)
		await sleep(15000)
		try {
			const hexRef = await bee.uploadData(batchID, data, {pin: true, tag: tagID})
			return hexToBytes(hexRef)
		}
		catch (err) {
			showBoth(`saveFunction RETRY ${data.length} bytes failed with ${err}`)
			throw err
		}
	}
	finally {
		//release();
	}
}

const loadFunction = async (address: Reference): Promise<Uint8Array> => {
	//showError(`Loading ${loadsActive}/${maxLoadsActive} @ ${Utils.Hex.bytesToHex(address)}`)
	//const [value, release] = await semaphoreManifestLoads.acquire();
	var start = new Date().getTime()
	var bytes = 0
	var r
	try {
		r = await bee.downloadData(bytesToHex(address))
		bytes = r.length
		if (bytes == 0) throw new Error('Zero Bytes Read');
	}
	catch (err) {
		const elapsed = Math.trunc((new Date().getTime() - start)/100+0.5)/10.0
		showBoth(`loadFunction ${bytesToHex(address)} failed in ${elapsed}s with ${err}`)
		throw err
	}
	finally {
		//release();
	}
	var elapsed = Math.trunc((new Date().getTime() - start)/100+0.5)/10.0
	if (elapsed >= 1)
		showError(`loadFunction(${Utils.Hex.bytesToHex(address)}) took ${elapsed}s`)
	//showError(`done loadActive:${loadsActive}/${maxLoadsActive}`)
	return r;
}

async function doit() {

	const addresses = await executeAPI(beeDebugUrl, "addresses")

	console.log(`overlay: ${addresses.overlay}`)
	console.log(`ethereum: ${addresses.ethereum}`)
	console.log(`${addresses.underlay.length} underlay addresses:`)

	for (var i=0; i<addresses.underlay.length; i++)
	{
		console.log(`    ${i}: ${addresses.underlay[i]}`)
	}

	const srcDir = "C:/swarm-bee/try-local/z1-8/OSM-Zoom-0-8"
	const rootNode = await newManifest(saveFunction, srcDir, "index.html")
	showBoth(`Uploaded ${srcDir} as ${rootNode}`)
	
//	await dumpManifest(loadFunction, rootNode, srcDir, undefined, undefined, false, false, false)

//	const srcDir = "r:/virtual machines/shared/wikipedia/bounty"
//	const rootNode = await newManifest(saveFunction, srcDir, "A/index")
//	showBoth(`Uploaded ${srcDir} as ${rootNode}`)
	
//	await dumpManifest(loadFunction, rootNode, srcDir, undefined, undefined, false, false, false)

	//const rootNode = await dumpManifest(loadFunction, '271b0c6b262a321be0e81748a43bf3dbc151ed2af45c1eae2906880eedc0b626', 'test18', undefined, undefined, false, false, false)	// Zoom 18 on testnet

	//const rootNode = await dumpManifest(loadFunction, 'e7104c27245a63445db6c58568f29e65fb28aa3f3ad80b1f9079e4cfef6cd9b6', 'bounty', undefined, undefined, false, false, false)	// Wikipedia bounty ZIM contents

	// const rootNode = await dumpManifest(loadFunction, '1c3d4b7466b70cc2a4bdfe9dba14c5cd88b56b731b51daf442a9958ac40dd290', 'bounty', undefined, undefined, false, false, false)	// Wikipedia bounty ZIM contents
}

doit()
