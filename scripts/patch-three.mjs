import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Backport Three's geometry-owned attribute cleanup without a renderer upgrade.
// Upstream: https://github.com/mrdoob/three.js/commit/4e369cb1ba5573a12141af76ca9b1febd2751a12
// Remove this patch only after a library upgrade passes the lifecycle regression.
export const original = "const geometryAttributes = renderObject.getAttributes();";
export const replacement = "const geometryAttributes = new Set( [ ...Object.values( geometry.attributes ), ...renderObject.getAttributes() ] ); // Master Blaster: Three #33939";
export function patchGeometryDisposal(source) {
  if (source.includes(replacement)) {
    assert.equal(source.split(replacement).length, 2, "duplicate Three cleanup patch");
    assert.ok(!source.includes(original), "mixed patched/unpatched Three cleanup");
    return source;
  }
  assert.equal(source.split(original).length, 2, "Three cleanup source changed; revalidate the backport");
  return source.replace(original, replacement);
}

// Adapt upstream's no-early-return observer path to r185's boolean refresh API.
// https://github.com/mrdoob/three.js/blob/e8356e918ca5d6a44010cd165ac267af8e106662/src/materials/nodes/manager/NodeMaterialObserver.js#L884-L917
// The first object still refreshes shared uniforms, but also synchronizes its
// comparison cache; otherwise changing draw order can freeze an old GPU matrix.
export const matrixOriginal = `\t\tconst { renderId } = nodeFrame;

\t\tif ( this.renderId !== renderId ) {

\t\t\tthis.renderId = renderId;

\t\t\treturn true;

\t\t}

\t\tconst isStatic = renderObject.object.static === true;
\t\tconst isBundle = renderObject.bundle !== null && renderObject.bundle.static === true && this.getRenderObjectData( renderObject ).version === renderObject.bundle.version;

\t\tif ( isStatic || isBundle )
\t\t\treturn false;

\t\tconst lightsData = this.getLights( renderObject.lightsNode, renderId );
\t\tconst notEqual = this.equals( renderObject, lightsData, renderId ) !== true;

\t\treturn notEqual;`;
export const matrixReplacement = matrixOriginal
  .replace("if ( this.renderId !== renderId ) {", "const firstRender = this.renderId !== renderId; // Master Blaster: synchronize observer fast path\n\n\t\tif ( firstRender ) {")
  .replace("\n\t\t\treturn true;\n", "")
  .replace("return false;", "return firstRender;")
  .replace("return notEqual;", "return firstRender || notEqual;");
export function patchObserverCache(source) {
  if (source.includes(matrixReplacement)) {
    assert.equal(source.split(matrixReplacement).length, 2, "duplicate Three observer patch");
    assert.ok(!source.includes(matrixOriginal), "mixed patched/unpatched Three observer");
    return source;
  }
  assert.equal(source.split(matrixOriginal).length, 2, "Three observer source changed; revalidate the cache correction");
  return source.replace(matrixOriginal, matrixReplacement);
}

// AttachedBindMode refreshes bindMatrixInverse when the mesh moves. The prior
// bone palette must be paired with the prior mesh bind transforms, not today's
// inverse (which otherwise counts root motion twice). Keep this per mesh:
// material-consolidated skins share skeletons, but can have distinct bindings.
export const skinningOriginal = "\treturn getSkinnedPosition( data.node, positionPrevious, bindMatrixNode, bindMatrixInverseNode, skinIndexNode, skinWeightNode );";
export const skinningState = `const _previousSkinningMatrices = new WeakMap(); // Master Blaster: previous bind transforms

function getPreviousSkinningMatrices( mesh, frameId ) {

	let state = _previousSkinningMatrices.get( mesh );
	if ( state === undefined ) {
		state = {
			frameId,
			currentBindMatrix: mesh.bindMatrix.clone(),
			currentBindMatrixInverse: mesh.bindMatrixInverse.clone(),
			previousBindMatrix: mesh.bindMatrix.clone(),
			previousBindMatrixInverse: mesh.bindMatrixInverse.clone()
		};
		_previousSkinningMatrices.set( mesh, state );
	} else if ( state.frameId !== frameId ) {
		state.previousBindMatrix.copy( state.currentBindMatrix );
		state.previousBindMatrixInverse.copy( state.currentBindMatrixInverse );
		state.currentBindMatrix.copy( mesh.bindMatrix );
		state.currentBindMatrixInverse.copy( mesh.bindMatrixInverse );
		state.frameId = frameId;
	}
	return state;

}

`;
export const skinningReplacement = `	// Shader programs can be reused by meshes with different skeletons.
	const previousBones = buffer( data.previousBoneMatrices, 'mat4', skeleton.bones.length ).onObjectUpdate( ( { object } ) => {
		const drawSkeleton = object?.isSkinnedMesh ? object.skeleton : skinnedMesh.skeleton;
		let drawData = _previousBoneMatricesData.get( drawSkeleton );
		if ( drawData === undefined ) {
			const previousBoneMatrices = new Float32Array( drawSkeleton.boneMatrices );
			drawData = { previousBoneMatrices, node: buffer( previousBoneMatrices, 'mat4', drawSkeleton.bones.length ) };
			_previousBoneMatricesData.set( drawSkeleton, drawData );
		}
		return drawData.previousBoneMatrices;
	} );
	const previousBind = uniform( 'mat4' ).onObjectUpdate( ( { object, frameId } ) =>
		getPreviousSkinningMatrices( object?.isSkinnedMesh ? object : skinnedMesh, frameId ).previousBindMatrix );
	const previousInverse = uniform( 'mat4' ).onObjectUpdate( ( { object, frameId } ) =>
		getPreviousSkinningMatrices( object?.isSkinnedMesh ? object : skinnedMesh, frameId ).previousBindMatrixInverse );
	return getSkinnedPosition( previousBones, positionPrevious, previousBind, previousInverse, skinIndexNode, skinWeightNode );`;
export function patchSkinningHistory(source) {
  if (source.includes(skinningReplacement)) {
    assert.equal(source.split(skinningReplacement).length, 2, "duplicate Three skinning patch");
    assert.equal(source.split(skinningState).length, 2, "missing/duplicate Three skinning state");
    assert.ok(!source.includes(skinningOriginal), "mixed patched/unpatched Three skinning");
    return source;
  }
  assert.equal(source.split(skinningOriginal).length, 2, "Three skinning source changed; revalidate previous bind transforms");
  const declaration = "function getPreviousSkinnedPosition( skinnedMesh, bindMatrixNode, bindMatrixInverseNode, skinIndexNode, skinWeightNode ) {";
  assert.equal(source.split(declaration).length, 2, "Three skinning declaration changed");
  assert.ok(!source.includes(skinningState), "mixed Three skinning state");
  return source.replace(declaration, skinningState + declaration).replace(skinningOriginal, skinningReplacement);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL("../node_modules/three/", import.meta.url);
  assert.equal(JSON.parse(readFileSync(new URL("package.json", root))).version, "0.185.1", "Three version changed; revalidate/remove the pinned corrections");
  // Validate every target before mechanically rewriting any installed file.
  const patches = ["src/renderers/common/Geometries.js", "src/materials/nodes/manager/NodeMaterialObserver.js", "src/nodes/accessors/Skinning.js", "build/three.webgpu.js", "build/three.webgpu.nodes.js"].map(path => {
    const url = new URL(path, root), source = readFileSync(url, "utf8");
    const bundled = path.startsWith("build/");
    let patched = source;
    if (bundled || path.includes("Geometries")) patched = patchGeometryDisposal(patched);
    if (bundled || path.includes("NodeMaterialObserver")) patched = patchObserverCache(patched);
    if (bundled || path.includes("Skinning")) patched = patchSkinningHistory(patched);
    return { url, source, patched };
  });
  for (const { url, source, patched } of patches) if (source !== patched) writeFileSync(url, patched);
  console.log("Three 0.185.1 geometry cleanup, observer cache and skinning history corrections verified.");
}
