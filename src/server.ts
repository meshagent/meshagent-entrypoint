import * as Y from "yjs";
import { v4 as uuid } from "uuid";

export interface ChangeNotificationElements {
  retain?: number;
  insert?: any[]; // Typically an array of serialized children
  delete?: number;
}

export interface ChangeNotificationAttributesSet {
  name: string;
  value: any;
}

export interface ChangeNotificationAttributes {
  set: ChangeNotificationAttributesSet[];
  delete: string[];
}

export interface ChangeNotificationText {
  retain?: number;
  insert?: string | any[];
  delete?: number;
  attributes?: Record<string, any>;
}

/**
 * A shape for the "message" passed to `notifyChanges`.
 * You can refine these fields further based on your usage.
 */
export interface ChangeNotification {
  root: boolean;
  target?: string;
  elements: ChangeNotificationElements[];
  attributes: ChangeNotificationAttributes;
  text: ChangeNotificationText[];
}

/**
 * A shape for changes you apply with `applyChanges()`.
 * Each "change" can contain multiple possible operations.
 */
export interface AppliedChange {
  nodeID?: string;
  delete?: boolean;
  insertChildren?: {
    after?: string;
    index?: number;
    children: any[];
  };
  deleteChildren?: {
    after?: string;
    index?: number;
    length: number;
  };
  removeAttributes?: string[];
  setAttributes?: Record<string, any>;
  insertText?: {
    index: number;
    text: string;
    attributes?: Record<string, any>;
  };
  formatText?: {
    from: number;
    length: number;
    attributes?: Record<string, any>;
  };
  deleteText?: {
    index: number;
    length: number;
  };
  undo?: boolean;
  redo?: boolean;
}

/**
 * ServerXmlDocument manages a Y.XmlElement ("xml" on the provided doc),
 * observing changes and applying them as needed.
 */
export class ServerXmlDocument {
  private _y: Y.XmlElement;
  private _undoManager: Y.UndoManager;

  public doc: Y.Doc;

  /**
   * @param doc The Y.Doc object containing an "xml" root element.
   * @param notifyChanges A callback invoked whenever Yjs observes changes (insert, delete, attribute changes, etc.)
   */
  constructor(doc: Y.Doc, notifyChanges: (msg: ChangeNotification) => void) {
    // "xml" root node
    this._y = doc.get("xml", Y.XmlElement) as Y.XmlElement;
    this._undoManager = new Y.UndoManager(this._y);

    this.doc = doc;

    // Observe changes in the Y.XmlElement tree
    this._y.observeDeep((yxmlEvents) => {
      for (const yxmlEvent of yxmlEvents) {
        const target = yxmlEvent.target;

        // If the target is an XmlElement...
        if (target instanceof Y.XmlElement) {
          const nodeID = target.getAttribute("$id");

          const message: ChangeNotification = {
            root: target === this._y,
            target: nodeID,
            elements: [],
            attributes: {
              set: [],
              delete: [],
            },
            text: [],
          };

          // Process element changes
          for (const delta of yxmlEvent.changes.delta) {
            if (delta.insert) {
              // "retain" can be undefined if no prior elements are retained
              message.elements.push({
                retain: delta.retain,
                insert: (delta.insert instanceof Array ? delta.insert : [delta.insert])
                    .map((i: Y.XmlElement | Y.XmlText) => this.serialize(i)),
              });
            } else if (delta.delete) {
              message.elements.push({
                retain: delta.retain,
                delete: delta.delete,
              });
            } else if (delta.retain) {
              message.elements.push({ retain: delta.retain });
            }
          }

          // Process attribute changes
          yxmlEvent.changes.keys.forEach((change, key) => {
            if (change.action === "add" || change.action === "update") {
              message.attributes.set.push({
                name: key,
                value: target.getAttribute(key),
              });
            } else if (change.action === "delete") {
              message.attributes.delete.push(key);
            }
          });

          notifyChanges(message);

        // If the target is an XmlText...
        } else if (target instanceof Y.XmlText) {
          const parent = target.parent as Y.XmlElement;
          const nodeID = parent?.getAttribute("$id") ?? undefined;

          const message: ChangeNotification = {
            root: false,
            target: nodeID,
            elements: [],
            attributes: {
              set: [],
              delete: [],
            },
            text: [],
          };

          // Process text deltas
          for (const delta of yxmlEvent.changes.delta) {
            if (delta.insert) {
              message.text.push({
                retain: delta.retain,
                insert: delta.insert,
              });
            } else if (delta.delete) {
              message.text.push({
                retain: delta.retain,
                delete: delta.delete,
              });
            } else if (delta.retain) {
              message.text.push({
                retain: delta.retain,
              });
            }
          }

          notifyChanges(message);
        } else {
          throw new Error("Unexpected target type");
        }
      }
    });
  }

  /**
   * Applies a Yjs update from a back-end source (e.g., via WebSocket).
   * @param changes A Uint8Array containing the Yjs update (diff).
   */
  public applyBackendChanges(changes: Uint8Array): void {
    // Optionally, you can pass an origin to track changes, e.g. Y.applyUpdate(this.doc, changes, "server")
    Y.applyUpdate(this.doc, changes);
  }

  public doUndo(): void {
    this._undoManager.undo();
  }

  public doRedo(): void {
    this._undoManager.redo();
  }

  /**
   * Serializes a Y.XmlElement or Y.XmlText into a JS object
   * that can be sent over the network or stored.
   */
  public serialize(node: Y.XmlElement | Y.XmlText): any {
    if (node instanceof Y.XmlElement) {
      const children: any[] = [];

      let n = node.firstChild;
      while (n) {
        const m = this.serialize(n);

        if (m) {
          children.push(m);
        }

        n = n.nextSibling;
      }

      return {
        element: {
          tagName: node.nodeName,
          attributes: node.getAttributes(),
          children: children,
        },
      };
    } else if (node instanceof Y.XmlText) {
      return {
        text: {
          delta: node.toDelta(),
        },
      };
    } else {
      throw new Error("Unexpected node type " + node);
    }
  }

  /**
   * Deletes the given element from its parent.
   */
  private doDelete(element: Y.XmlElement | Y.XmlText): void {
    if (element.parent instanceof Y.XmlElement) {
      let i = 0;
      let cur = element.parent.firstChild;

      // Find index of `element` among siblings
      while (cur) {
        if (cur === element) {
          element.parent.delete(i, 1);
          return;
        }
        i++;
        cur = cur.nextSibling;
      }

      throw new Error("Element was not found among parent's children.");
    } else {
      throw new Error("Cannot delete top-level element.");
    }
  }

  /**
   * Constructs Y.XmlNodes from a given array of child definitions.
   */
  private createNodes(children: any[]): Array<Y.XmlElement | Y.XmlText> {
    const nodes: Array<Y.XmlElement | Y.XmlText> = [];

    for (const child of children) {
      if (child.text) {
        // Create Y.XmlText
        const text = new Y.XmlText();
        // If there's a "delta" in child.text, apply it here if needed
        // But the code just checks "if (text.delta)..." in your original snippet is somewhat unclear
        // Possibly: text.applyDelta(child.text.delta);
        // We'll do it only if child.text.delta actually exists:
        if (child.text.delta) {
          text.applyDelta(child.text.delta);
        }
        nodes.push(text);
      } else if (child.element) {
        // Create Y.XmlElement
        const element = new Y.XmlElement(child.element.name);
        // Default ID if not specified
        element.setAttribute("$id", child.element.attributes?.id ?? uuid());

        // Set attributes
        if (child.element.attributes) {
          for (const k of Object.keys(child.element.attributes)) {
            element.setAttribute(k, child.element.attributes[k]);
          }
        }

        // Create & insert children recursively
        if (child.element.children) {
          element.insert(0, this.createNodes(child.element.children));
        }
        nodes.push(element);
      } else {
        throw new Error("Unexpected XML data item (not text or element).");
      }
    }

    return nodes;
  }

  /**
   * Inserts children into a Y.XmlElement, either after a specified child,
   * at a given index, or by pushing onto the end if neither is specified.
   */
  private doInsertChildren(element: Y.XmlElement,
    {
      after,
      index,
      children,
    }: {
      after?: string;
      index?: number;
      children: any[];
    }
  ): void {
    let afterElement: Y.XmlElement | null = null;

    if (after) {
      for (let e = element.firstChild; e != null; e = e.nextSibling) {
        if (e instanceof Y.XmlElement) {
          if (e.getAttribute("$id") === after) {
            afterElement = e;
            break;
          }
        }
      }
      if (!afterElement) {
        throw new Error("Unable to find child element to insert after: " + after);
      }
    }

    if (afterElement) {
      element.insertAfter(afterElement, this.createNodes(children));
    } else {
      // Insert at a given index if provided
      if (index !== undefined && index !== null) {
        element.insert(index, this.createNodes(children));
      } else {
        // Otherwise, push them to the end
        element.push(this.createNodes(children));
      }
    }
  }

  /**
   * Deletes a range of children from a Y.XmlElement, either immediately after a specified child
   * or starting at a given index.
   */
  private doDeleteChildren(
    element: Y.XmlElement,
    {
      after,
      index,
      length,
    }: {
      after?: string;
      index?: number;
      length: number;
    }
  ): void {
    if (after) {
      let afterElement: Y.XmlElement | null = null;
      let i = 0;
      for (let e = element.firstChild; e != null; e = e.nextSibling) {
        if (e instanceof Y.XmlElement) {
          if (e.getAttribute("$id") === after) {
            afterElement = e;
            break;
          }
        }
        i++;
      }
      if (!afterElement) {
        throw new Error("Unable to find child element to insert after: " + after);
      }
      element.delete(i, length);
    } else {
      if (index === undefined || index === null) {
        throw new Error("No 'index' specified for deleteChildren.");
      }
      element.delete(index, length);
    }
  }

  /**
   * Removes an array of attributes from a Y.XmlElement.
   */
  private doRemoveAttributes(element: Y.XmlElement, attributes: string[]): void {
    for (const k of attributes) {
      element.removeAttribute(k);
    }
  }

  /**
   * Sets multiple attributes on a Y.XmlElement.
   */
  private doSetAttributes(
    element: Y.XmlElement,
    attributes: Record<string, any>
  ): void {
    for (const k of Object.keys(attributes)) {
      element.setAttribute(k, attributes[k]);
    }
  }

  /**
   * Recursively searches for a node with matching $id (or the root if none specified).
   */
  private findNode(nodeID?: string, root: Y.XmlElement | Y.XmlText = this._y): Y.XmlElement | Y.XmlText | null {
    if (!nodeID) {
      return root;
    }
    if (root instanceof Y.XmlElement) {
      if (root.getAttribute("$id") === nodeID) {
        return root;
      }
      for (let e = root.firstChild; e != null; e = e.nextSibling) {
        const child = this.findNode(nodeID, e);
        if (child) {
          return child;
        }
      }
    }
    return null;
  }

  /**
   * Inserts text into a text node at the specified index, optionally with attributes.
   */
  private doInsertText(
    element: Y.XmlElement,
    { index, text, attributes }: { index: number; text: string; attributes?: Record<string, any> }
  ): void {
    if (element.nodeName !== "text") {
      throw new Error("Can only insert text in a text node.");
    }
    const xmlText = element.firstChild as Y.XmlText;
    xmlText.insert(index, text, attributes);
  }

  /**
   * Formats text (applying attributes) within a text node, for a given range.
   */
  private doFormatText(
    element: Y.XmlElement,
    { from, length, attributes }: { from: number; length: number; attributes?: Record<string, any> }
  ): void {
    if (element.nodeName !== "text") {
      throw new Error("Can only format text in a text node.");
    }
    const xmlText = element.firstChild as Y.XmlText;
    xmlText.format(from, length, attributes || {});
  }

  /**
   * Deletes text from a text node for a given range.
   */
  private doDeleteText(
    element: Y.XmlElement,
    { index, length }: { index: number; length: number }
  ): void {
    if (element.nodeName !== "text") {
      throw new Error("Can only delete text in a text node.");
    }
    const xmlText = element.firstChild as Y.XmlText;
    xmlText.delete(index, length);
  }

  /**
   * Applies a sequence of changes (insert/delete children, set/remove attributes, etc.) to the Y.Xml tree.
   */
  public applyChanges(changes: Array<AppliedChange>): void {
    for (const change of changes) {
      // If nodeID is provided, find that node; otherwise use the root
      const elementOrText = change.nodeID ? this.findNode(change.nodeID) : this._y;

      if (elementOrText == null) {
        throw new Error("Element was not found for nodeID " + change.nodeID);
      }

      // 1) Delete the entire element if requested
      if (change.delete) {
        this.doDelete(elementOrText);
      }

      // 2) Insert children
      if (change.insertChildren) {
        if (!(elementOrText instanceof Y.XmlElement)) {
          throw new Error("Cannot insert children into a text node.");
        }
        this.doInsertChildren(elementOrText, change.insertChildren);
      }

      // 3) Delete children
      if (change.deleteChildren) {
        if (!(elementOrText instanceof Y.XmlElement)) {
          throw new Error("Cannot delete children of a text node.");
        }
        this.doDeleteChildren(elementOrText, change.deleteChildren);
      }

      // 4) Remove attributes
      if (change.removeAttributes) {
        if (!(elementOrText instanceof Y.XmlElement)) {
          throw new Error("Cannot remove attributes from a text node.");
        }
        this.doRemoveAttributes(elementOrText, change.removeAttributes);
      }

      // 5) Set attributes
      if (change.setAttributes) {
        if (!(elementOrText instanceof Y.XmlElement)) {
          throw new Error("Cannot set attributes on a text node.");
        }
        this.doSetAttributes(elementOrText, change.setAttributes);
      }

      // 6) Insert text
      if (change.insertText) {
        if (!(elementOrText instanceof Y.XmlElement)) {
          throw new Error("Node is not a text element.");
        }
        this.doInsertText(elementOrText, change.insertText);
      }

      // 7) Format text
      if (change.formatText) {
        if (!(elementOrText instanceof Y.XmlElement)) {
          throw new Error("Node is not a text element.");
        }
        this.doFormatText(elementOrText, change.formatText);
      }

      // 8) Delete text
      if (change.deleteText) {
        if (!(elementOrText instanceof Y.XmlElement)) {
          throw new Error("Node is not a text element.");
        }
        this.doDeleteText(elementOrText, change.deleteText);
      }

      // 9) Undo previous change
      if (change.undo) {
        this.doUndo();
      }

      if (change.redo) {
        this.doRedo();
      }
    }
  }
}
