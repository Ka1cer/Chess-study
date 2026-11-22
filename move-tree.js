/* Chess Study — hierarchical move tree (v3.2 development). */
(function (global) {
  "use strict";

  const copyMove = move => move ? { ...move } : null;
  const sameMove = (a, b) => Boolean(a && b) &&
    a.from === b.from && a.to === b.to &&
    (a.promotion || "") === (b.promotion || "");

  function makeNode(move, parent) {
    return {
      id: "node-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9),
      move: copyMove(move),
      parent: parent || null,
      children: []
    };
  }

  class MoveTree {
    constructor(mainMoves) {
      this.root = makeNode(null, null);
      this.current = this.root;
      if (Array.isArray(mainMoves) && mainMoves.length) this.appendLine(mainMoves);
    }

    getNodePath(node) {
      const path = [];
      let cursor = node || this.current;
      while (cursor && cursor !== this.root) {
        path.push(cursor);
        cursor = cursor.parent;
      }
      return path.reverse();
    }

    getPath(node) {
      return this.getNodePath(node).map(item => copyMove(item.move));
    }

    findChild(parent, move) {
      return parent.children.find(child => sameMove(child.move, move)) || null;
    }

    appendLine(moves) {
      let parent = this.root;
      for (const move of moves || []) {
        let node = this.findChild(parent, move);
        if (!node) {
          node = makeNode(move, parent);
          parent.children.push(node);
        }
        parent = node;
      }
      this.current = parent;
      return parent;
    }

    addMove(parent, move, options) {
      parent = parent || this.current || this.root;
      const existing = this.findChild(parent, move);
      if (existing) {
        this.current = existing;
        return { node: existing, created: false };
      }
      const node = makeNode(move, parent);
      const asMain = Boolean(options && options.asMain);
      if (asMain) parent.children.unshift(node);
      else parent.children.push(node);
      this.current = node;
      return { node, created: true };
    }

    mainLeafFrom(node) {
      let cursor = node || this.root;
      while (cursor.children.length) cursor = cursor.children[0];
      return cursor;
    }

    atPath(moves) {
      let node = this.root;
      for (const move of moves || []) {
        node = this.findChild(node, move);
        if (!node) return null;
      }
      return node;
    }

    findNode(id) {
      if (!id) return null;
      const visit = node => {
        if (node.id === id) return node;
        for (const child of node.children) {
          const found = visit(child);
          if (found) return found;
        }
        return null;
      };
      return visit(this.root);
    }

    promoteToMain(node) {
      if (!node || node === this.root || !node.parent) return false;
      const siblings = node.parent.children;
      const index = siblings.indexOf(node);
      if (index <= 0) return false;
      siblings.splice(index, 1);
      siblings.unshift(node);
      return true;
    }

    removeBranch(node) {
      if (!node || node === this.root || !node.parent) return false;
      const siblings = node.parent.children;
      const index = siblings.indexOf(node);
      if (index < 0) return false;
      if (this.isAncestor(node, this.current)) this.current = node.parent;
      siblings.splice(index, 1);
      return true;
    }

    isAncestor(ancestor, node) {
      let cursor = node;
      while (cursor) {
        if (cursor === ancestor) return true;
        cursor = cursor.parent;
      }
      return false;
    }

    firstAlternativeOnPath(node) {
      let selected = null;
      for (const item of this.getNodePath(node)) {
        if (item.parent && item.parent.children.indexOf(item) > 0) selected = item;
      }
      return selected;
    }

    toLines() {
      const lines = [];
      const visit = (node, path) => {
        if (!node.children.length) {
          if (path.length) lines.push(path.map(copyMove));
          return;
        }
        node.children.forEach(child => visit(child, path.concat([child.move])));
      };
      visit(this.root, []);
      return lines;
    }

    serialize() {
      const encode = node => ({
        id: node.id,
        move: copyMove(node.move),
        children: node.children.map(encode)
      });
      return encode(this.root);
    }

    static fromSerialized(data) {
      const tree = new MoveTree();
      if (!data || !Array.isArray(data.children)) return tree;
      const decode = (source, parent) => {
        const node = makeNode(source.move, parent);
        if (source.id) node.id = source.id;
        for (const child of Array.isArray(source.children) ? source.children : []) {
          node.children.push(decode(child, node));
        }
        return node;
      };
      tree.root.children = data.children.map(child => decode(child, tree.root));
      return tree;
    }

    static fromLegacyLines(lines) {
      const tree = new MoveTree();
      const ordered = (lines || []).slice().sort((a, b) =>
        (a.id === "main" ? -1 : 0) - (b.id === "main" ? -1 : 0)
      );
      ordered.forEach(line => tree.appendLine(line.moves || []));
      tree.current = tree.root;
      return tree;
    }
  }

  global.ChessStudyMoveTree = MoveTree;
})(typeof window !== "undefined" ? window : globalThis);
