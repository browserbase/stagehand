function mergeOutput(target: any, source: any) {
    const output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
        if (Array.isArray(source[key])) {
            output[key] = [...(target[key] || []), ...source[key]];
        } else if (isObject(source[key])) {
            if (!(key in target))
            Object.assign(output, { [key]: source[key] });
            else
            output[key] = mergeOutput(target[key], source[key]);
        } else {
            Object.assign(output, { [key]: source[key] ? source[key] : target[key] });
        }
        });
    }
    return output;
}

function isObject(item: any) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

export { mergeOutput, isObject };
