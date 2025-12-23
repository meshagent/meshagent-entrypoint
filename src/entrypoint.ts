import * as Y from "yjs";
import { ServerXmlDocument, ChangeNotification } from "./server"; // Adjust path as needed
import base64 from "base-64";

/**
 * A callback signature for Y.Doc 'update' events. Typically,
 * Y.js passes the `update` (a Uint8Array) and an optional `origin`.
 */
type OnUpdateCallback = (update: Uint8Array, origin?: any) => void;


export function uint8ArrayToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000; // 32KB chunks to avoid call stack limits

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}


export function base64ToUint8Array(base64: string) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}


/**
 * ClientProtocol holds a Y.Doc and applies/receives updates
 * for a "client" instance.
 */
class ClientProtocol {
  public doc: Y.Doc;

  constructor(onClientUpdate: OnUpdateCallback) {
    this.doc = new Y.Doc();
    // Trigger onClientUpdate whenever doc updates
    this.doc.on("update", onClientUpdate);
  }

  update(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update);
  }
}

/**
 * Placeholder: If your ServerXmlDocument, ClientProtocol have different types/constructors,
 * adjust these definitions accordingly.
 */
export interface UpdatePayload {
  documentID: string;
  changes: any;
}

export type SendUpdateFn = (msg: string) => void;

// In TypeScript, we'll store them in Maps with well-defined key/value types
const protocols: Map<string, ClientProtocol> = new Map();
const documents: Map<string, ServerXmlDocument> = new Map();

/**
 * Applies "changes" to the server document identified by update.documentID,
 * then logs the updated XML state via the associated Y.Doc.
 */
export function applyChanges(update: UpdatePayload): void {
  //console.log("applying", JSON.stringify(update.changes));

  const server = documents.get(update.documentID);
  if (!server) {
    throw new Error("cannot apply changes, document was not registered " + update.documentID);
  }

  server.applyChanges(update.changes);
}

/**
 * Retrieves the state update (as a base64-encoded string) for a given documentID.
 * If a `vector` is provided, we interpret it as a base64-encoded State Vector for
 * partial sync updates.
 */
export function getState(documentID: string, vector?: string): string {
  const server = documents.get(documentID);
  if (!server) {
    throw new Error("Document not registered: " + documentID);
  }

  let state: Uint8Array;

  if (vector) {
    // Convert the base64-encoded vector into a Uint8Array
    const decodedVector = base64.decode(vector);
    const stateVector = Uint8Array.from(decodedVector, (c) => c.charCodeAt(0));
    // Encode the document's state as an update from that vector
    state = Y.encodeStateAsUpdate(server.doc, stateVector);
  } else {
    // Encode the entire document's state
    state = Y.encodeStateAsUpdate(server.doc);
  }

  // Return as base64
  return uint8ArrayToBase64(state);
}

/**
 * Returns a base64-encoded 'state vector' of the Y.Doc for the given document.
 */
export function getStateVector(documentID: string): string {
  const server = documents.get(documentID);
  if (!server) {
    throw new Error("Document not registered: " + documentID);
  }

  const state = Y.encodeStateVector(server.doc);
  return uint8ArrayToBase64(state);
}

/**
 * Applies a base64-encoded update (backend change) to the specified document.
 */
export function applyBackendChanges(documentID: string, base64Changes: string): void {
  const server = documents.get(documentID);
  if (!server) {
    throw new Error(
      "cannot apply changes, document was not registered " + documentID
    );
  }

  //console.log("applying", JSON.stringify(base64Changes));
  const buffer = Uint8Array.from(base64.decode(base64Changes), (c) =>
    c.charCodeAt(0)
  );

  //console.log("applying", Array.from(buffer));
  server.applyBackendChanges(buffer);

  // Log updated doc state
  const protocol = protocols.get(documentID);
  if (protocol) {
    const xmlRoot = protocol.doc.get("xml", Y.XmlElement) as Y.XmlElement;
    //console.log(xmlRoot.toString());
  }
}

/**
 * Registers a new ServerXmlDocument and ClientProtocol for the given ID.
 * Optionally applies an initial base64 state. If no custom callbacks are passed,
 * it falls back to default placeholders (onSendUpdateToBackend / onSendUpdateToClient).
 */
export function registerDocument(
  id: string,
  base64Data: string | null,
  undo: boolean = false,
  sendUpdateToBackend?: SendUpdateFn,
  sendUpdateToClient?: SendUpdateFn,
): void {
  if (documents.get(id)) {
    throw new Error("document is already registered " + id);
  }

  // Create a client protocol that, on updates, calls "sendUpdateToBackend"
  const clientProtocol = new ClientProtocol((update: Uint8Array) => {
    const msg = JSON.stringify({
        documentID: id,
        data: uint8ArrayToBase64(update),
    });
    const fn = sendUpdateToBackend ?? onSendUpdateToBackend;

    if (fn) {
      fn(msg);
    }
  });

  // Create a server doc that, on updates, calls "sendUpdateToClient"
  const server = new ServerXmlDocument(clientProtocol.doc, undo, (update: ChangeNotification) => {
    const msg = JSON.stringify({ documentID: id, data: update });
    const fn = sendUpdateToClient ?? onSendUpdateToClient;

    if (fn) {
      fn(msg);
    }
  });

  // If there's initial base64 data, apply it as a backend change
  if (base64Data) {
    const buffer = Uint8Array.from(base64.decode(base64Data), (c) => c.charCodeAt(0));

    server.applyBackendChanges(buffer);
  }

  // Store references
  documents.set(id, server);
  protocols.set(id, clientProtocol);
}

/**
 * Unregisters a document from internal Maps. Subsequent attempts
 * to apply changes on it will fail.
 */
export function unregisterDocument(id: string): void {
  if (!documents.has(id)) {
    throw new Error("document was not registered " + id);
  }

  documents.delete(id);
  protocols.delete(id);
}

