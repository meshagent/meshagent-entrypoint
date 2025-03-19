// File: server-xml-document.spec.ts
import * as Y from "yjs";
import { ServerXmlDocument, ChangeNotification } from "../src/server";
import { expect } from "chai";

// Helper to quickly set up a Y.Doc + ServerXmlDocument + notification collector
function createTestServerXmlDocument() {
  const doc = new Y.Doc();
  const notifications: ChangeNotification[] = [];

  // Our "notifyChanges" callback that captures each notification
  const notifyChanges = (msg: ChangeNotification) => notifications.push(msg);

  // Instantiate the server doc
  const server = new ServerXmlDocument(doc, notifyChanges);

  return { doc, server, notifications };
}

describe("ServerXmlDocument", () => {
  it("notifies about inserted child elements", () => {
    const { doc, notifications } = createTestServerXmlDocument();

    const root = doc.get("xml", Y.XmlElement) as Y.XmlElement;
    expect(root, "Should have a root Y.XmlElement").to.exist;

    // Insert a single child element at index 0
    const child = new Y.XmlElement("div");
    child.setAttribute("$id", "child-1");
    root.insert(0, [child]);

    // We expect one or more notifications because of the insertion
    expect(notifications.length).to.be.greaterThan(0, "Should have at least one notification");

    // Typically, Yjs coalesces changes into a single event, so let's look at the first one:
    const firstNotif = notifications[0];

    expect(firstNotif.root).to.equal(true, "Change should be on the root element");

    // We inserted 1 element => firstNotif.elements[0].insert should contain it
    expect(firstNotif.elements).to.have.lengthOf(1, "One delta object in 'elements'");
    const delta = firstNotif.elements[0];
    // `delta.insert` is an array of serialized children
    if (!delta.insert) {
      throw new Error("Expected delta.insert to be defined");
    }
    expect(delta.insert).to.have.lengthOf(1, "One inserted child element");
    const inserted = delta.insert![0];
    expect(inserted).to.have.property("element");

    const element = inserted.element;

    expect(element).to.have.property("tagName", "div");
    expect(element).to.have.property("attributes");
    expect(element.attributes).to.deep.equal({ $id: "child-1" });
  });

  it("notifies about attribute changes", () => {
    const { doc, notifications } = createTestServerXmlDocument();

    const root = doc.get("xml", Y.XmlElement) as Y.XmlElement;
    root.setAttribute("$id", "root-id"); // So the server has a known ID for root
    notifications.splice(0); // Clear out any prior notifications

    // Change an attribute on the root
    root.setAttribute("foo", "bar");

    expect(notifications.length).to.be.greaterThan(0, "Should receive a notification from attribute change");
    const change = notifications[0];
    expect(change.root).to.equal(true, "It's the root element");
    // We changed 'foo'
    expect(change.attributes.set).to.deep.include({ name: "foo", value: "bar" });
    expect(change.attributes.delete).to.have.lengthOf(0);
  });

  it("notifies about text insertion in a text node", () => {
    const { doc, notifications } = createTestServerXmlDocument();

    const root = doc.get("xml", Y.XmlElement) as Y.XmlElement;
    root.setAttribute("$id", "root-id");

    // Create a <text> node with Y.XmlText inside
    const textElement = new Y.XmlElement("text");
    textElement.setAttribute("$id", "text-1");
    const yText = new Y.XmlText();
    textElement.insert(0, [yText]);

    // Insert the <text> node into the root
    root.push([textElement]);
    notifications.splice(0); // Clear insertion notifications

    // Insert text content at index 0
    yText.insert(0, "Hello World");

    // We should get a notification about text insertion
    expect(notifications.length).to.be.greaterThan(0, "Should receive a text-change notification");
    const msg = notifications[0];
    expect(msg.root).to.equal(false, "root should be false for text changes (the text node's parent is root, not the text node itself)");
    expect(msg.target).to.equal("text-1", "The target should be the text element's $id");

    // Check the 'text' deltas
    expect(msg.text).to.have.lengthOf(1);
    expect(msg.text[0]).to.include({ insert: "Hello World" });
    // "retain" might be undefined if we inserted at position 0
  });

  it("applies child element insertion via applyChanges()", () => {
    const { doc, server } = createTestServerXmlDocument();

    const root = doc.get("xml", Y.XmlElement) as Y.XmlElement;
    root.setAttribute("$id", "root-id");

    // We'll call `applyChanges` to insert a new child on root
    server.applyChanges([
      {
        nodeID: "root-id",
        insertChildren: {
          // We can either provide an index or `after` an existing child
          index: 0,
          children: [
            {
              element: {
                name: "my-child",
                attributes: { title: "ChildTitle", id: "child-id-123" },
                children: [],
              },
            },
          ],
        },
      },
    ]);

    // Now the root should have 1 child
    expect(root.length).to.equal(1);
    const child = root.get(0) as Y.XmlElement;
    expect(child.nodeName).to.equal("my-child");
    expect(child.getAttribute("title")).to.equal("ChildTitle");
    // Our code sets `$id` as `child.element.attributes?.id ?? uuid()`
    // So if your code uses "id" for $id, we can check that:
    expect(child.getAttribute("$id")).to.equal("child-id-123");
  });

  it("applies text insertion via applyChanges()", () => {
    const { doc, server } = createTestServerXmlDocument();

    const root = doc.get("xml", Y.XmlElement) as Y.XmlElement;
    root.setAttribute("$id", "root-id");

    // Create a text node in root
    const textElement = new Y.XmlElement("text");
    textElement.setAttribute("$id", "text-xyz");
    const yText = new Y.XmlText();
    textElement.insert(0, [yText]);
    root.push([textElement]);

    // Insert "Hello" at index 0, then a space, then "World"
    server.applyChanges([
      {
        nodeID: "text-xyz",
        insertText: {
          index: 0,
          text: "Hello ",
        },
      },
      {
        nodeID: "text-xyz",
        insertText: {
          index: 6,
          text: "World",
        },
      },
    ]);

    expect(yText.toString()).to.equal("Hello World");
  });

  it("can format text via applyChanges()", () => {
    const { doc, server } = createTestServerXmlDocument();

    const root = doc.get("xml", Y.XmlElement) as Y.XmlElement;
    root.setAttribute("$id", "root-id");

    // Create a text node in root
    const textElement = new Y.XmlElement("text");
    textElement.setAttribute("$id", "txt-123");
    const yText = new Y.XmlText();
    textElement.insert(0, [yText]);
    root.push([textElement]);

    // Insert text
    yText.insert(0, "Hello World");

    // Format "World" (start at index 6, length 5)
    server.applyChanges([
      {
        nodeID: "txt-123",
        formatText: {
          from: 6,
          length: 5,
          attributes: { bold: true },
        },
      },
    ]);

    // The underlying Yjs representation is a delta
    // We can confirm the second operation is "World" with bold = true
    const delta = yText.toDelta();
    expect(delta).to.have.lengthOf(2); 
    // 1) "Hello "
    expect(delta[0].insert).to.equal("Hello ");
    expect(delta[0].attributes).to.be.undefined;

    // 2) "World" with { bold: true }
    expect(delta[1].insert).to.equal("World");
    expect(delta[1].attributes).to.deep.equal({ bold: true });
  });

  it("can delete text via applyChanges()", () => {
    const { doc, server } = createTestServerXmlDocument();

    const root = doc.get("xml", Y.XmlElement) as Y.XmlElement;
    root.setAttribute("$id", "root-id");

    // Create a text node with "Hello World"
    const textElement = new Y.XmlElement("text");
    textElement.setAttribute("$id", "txt-abc");
    const yText = new Y.XmlText();
    yText.insert(0, "Hello World");
    textElement.insert(0, [yText]);
    root.push([textElement]);

    // Delete "World" (i.e., 5 chars from index 6)
    server.applyChanges([
      {
        nodeID: "txt-abc",
        deleteText: {
          index: 6,
          length: 5,
        },
      },
    ]);

    expect(yText.toString()).to.equal("Hello ");
  });

  it("can delete the entire element via applyChanges()", () => {
    const { doc, server } = createTestServerXmlDocument();

    const root = doc.get("xml", Y.XmlElement) as Y.XmlElement;
    root.setAttribute("$id", "root-id");

    // Insert a child
    const child = new Y.XmlElement("section");
    child.setAttribute("$id", "child-xyz");
    root.push([child]);
    expect(root.length).to.equal(1);

    // Delete the child by nodeID
    server.applyChanges([
      {
        nodeID: "child-xyz",
        delete: true,
      },
    ]);

    expect(root.length).to.equal(0);
  });
});
