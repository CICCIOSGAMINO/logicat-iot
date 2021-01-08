/**
 * Check if the id field is present with right value present
 * into the ids array too.
 *
 * @param { object } jsonObj - JSON data object (single item)
 * @param { array } ids - Array with all valid ids
 * @returns { boolean } - true if is a valid id
 */
export const checkId = (jsonObj, ids) => {
  // validity of id field in object and array
  try {
    if (ids instanceof Array && ids.includes(jsonObj.id)) {
      return true
    }
    return false
  } catch (err) {
    return false
  }
}
