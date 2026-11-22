/* Chess Study — hierarchical move tree (v3.2 development)
 * This module is introduced separately so the existing game UI stays untouched
 * while the move-widget integration is tested.
 */
(function (global) {
  "use strict";

  const cloneMove = move => move ? {
    color: move.color,
    from: move.from,
    to: move.to,
    san: move.san,
    piece: move.piece,
    captured: move.captured,
    promotion: move.promotion,
    flags: move.flags,
    lan: move.lan,
    before: move.before,
    after: move.after
  } : null;

  const sameMove = (a, b) => Boolean(a && b) &&
    a.from === b.from && a.to === b.to &&
    (a.promotion || "") === (b.promotion || "");

  function makeNode(move, parent) {
    return {
      id: "node-" + Math.random().toString(36).slice(2) + Date.now().toString(36),
      move: cloneMove(move),
      parent: parent || null,
      children: []
    };
  }

  class MoveTree {
    constructor(moves) {
      this.root = makeNode(null, null);
      this.current = this.root;
      if (Array.isArray(moves)) this.appendMainLine(moves);
    }

    appendMainLine(moves) {
      let parent = this.root;
      for (const move of moves) {
        let node = parent.children.find(child => sameMove(child.move, move));
        if (!node) {
          node = makeNode(move, parent);
          parent.children.unshift(node);
        }
        parent = node;
      }
      return parent;
    }

    getPath(node) {
      const path = [];
      let cursor = node || this.current;
      while (cursor && cursor !== this.root) {
        path.push(cloneMove(cursor.move));
        cursor = cursor.parent;
      }
      return path.reverse();
    }

    getMainChild(node) {
      return node && node.children.length ? node.children[0] : null;
    }

    findChild(parent, move) {
      return parent.children.find(child => sameMove(child.move, move)) || null;
    }

    addMove(move, options) {
      const parent = this.current;
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

    select(node) {
      if (!node || !this.isInTree(node)) return false;
      this.current = node;
      return true;
    }

    isInTree(node) {
      let cursor = node;
      while (cursor && cursor !== this.root) cursor = cursor.parent;
      return cursor === this.root;
    }

    atPath(path) {
      let node = this.root;
      for (const move of path || []) {
        node = this.findChild(node, move);
        if (!node) return null;
      }
      return node;
    }

    addVariationAtCurrent(move) {
      const result = this.addMove(move, { asMain: false });
      return result;
    }

    promoteToMain(node) {
      if (!node || node === this.root || !node.parent) return false;
      const siblings = node.parent.children;
      const index = siblings.indexOf(node);
      if (index < 0) return false;
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
      while (cursor && cursor !== this.root) {
        if (cursor === ancestor) return true;
        cursor = cursor.parent;
      }
      return false;
    }

    toLines() {
      const lines = [];
      const visit = (node, path, branchPath) => {
        if (!node.children.length) {
          if (path.length) lines.push({ moves: path.map(cloneMove), branchPath: branchPath.slice() });
          return;
        }
        node.children.forEach((child, index) => {
          const nextPath = path.concat([child.move]);
          const nextBranches = index === 0 ? branchPath : branchPath.concat([child.id]);
          visit(child, nextPath, nextBranches);
        });
      };
      visit(this.root, [], []);
      return lines;
    }

    serialize() {
      const encode = node => ({
        id: node.id,
        move: cloneMove(node.move),
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
  }

  global.ChessStudyMoveTree = MoveTree;
})(typeof window !== "undefined" ? window : globalThis);
