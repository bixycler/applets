/**
 * Decode an encoded markup string of HTML or XML.
 *
 * @param encStr  encoded string
 * @returns {string} decoded string
 */
function decodeML(encStr) {
    let txt = document.createElement("textarea");
    txt.innerHTML = encStr;
    return txt.value;
}

/**
 * Parse a markup string into a DOM tree.
 *
 * @param str the markup string
 * @param ml {DOMParserSupportedType} "text/html" | "text/xml" | "image/svg+xml"
 * @returns {Document} the DOM tree
 */
function parseDOM(str, ml='text/html') {
    let dom = new DOMParser().parseFromString(str, ml);
    return dom;
}
